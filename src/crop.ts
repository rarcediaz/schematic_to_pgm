/** A minimal, DOM-independent representation of RGBA image data. */
export interface RgbaPixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: ArrayLike<number>
}

/**
 * Integer pixel bounds. `right` and `bottom` are exclusive, matching canvas
 * source rectangles and making the crop size `right - left` by `bottom - top`.
 */
export interface PixelBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface ViewportDimensions {
  readonly width: number
  readonly height: number
}

export interface DifferenceBoundsOptions {
  /**
   * Maximum composited RGB difference treated as unchanged. Set to zero to
   * include every non-identical visible pixel. Defaults to 16.
   */
  readonly differenceThreshold?: number
  /**
   * Minimum number of 8-connected changed pixels retained as a component.
   * Defaults to 8, which rejects isolated rasterisation noise.
   */
  readonly minComponentPixels?: number
}

const DEFAULT_DIFFERENCE_THRESHOLD = 16
const DEFAULT_MIN_COMPONENT_PIXELS = 8
const RGBA_CHANNELS_PER_PIXEL = 4
const MILLIMETRES_PER_INCH = 25.4

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`)
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`)
  }
}

function validatePixelBuffer(buffer: RgbaPixelBuffer, name: string): void {
  assertPositiveInteger(buffer.width, `${name}.width`)
  assertPositiveInteger(buffer.height, `${name}.height`)

  const requiredLength = buffer.width * buffer.height * RGBA_CHANNELS_PER_PIXEL
  if (!Number.isSafeInteger(requiredLength) || buffer.data.length < requiredLength) {
    throw new RangeError(
      `${name}.data must contain four RGBA channels for every pixel.`,
    )
  }
}

function validateDimensions(dimensions: ViewportDimensions, name: string): void {
  assertPositiveInteger(dimensions.width, `${name}.width`)
  assertPositiveInteger(dimensions.height, `${name}.height`)
}

function validateBounds(bounds: PixelBounds): void {
  const values = [bounds.left, bounds.top, bounds.right, bounds.bottom]
  if (!values.every(Number.isInteger)) {
    throw new RangeError('Pixel bounds must contain integer coordinates.')
  }
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    throw new RangeError('Pixel bounds must have a positive width and height.')
  }
}

function compositeChannelOverWhite(channel: number, alpha: number): number {
  return 255 - ((255 - channel) * alpha) / 255
}

function visibleRgbDifference(
  first: ArrayLike<number>,
  second: ArrayLike<number>,
  offset: number,
): number {
  const firstAlpha = first[offset + 3] ?? 0
  const secondAlpha = second[offset + 3] ?? 0
  let difference = 0

  for (let channel = 0; channel < 3; channel += 1) {
    const firstValue = compositeChannelOverWhite(
      first[offset + channel] ?? 0,
      firstAlpha,
    )
    const secondValue = compositeChannelOverWhite(
      second[offset + channel] ?? 0,
      secondAlpha,
    )
    difference = Math.max(difference, Math.abs(firstValue - secondValue))
  }

  return difference
}

/**
 * Finds the union of meaningful visible changes between two RGBA renders.
 *
 * Pixels are compared after compositing over white, so RGB bytes hidden behind
 * fully transparent alpha do not create a crop. Small 8-connected components
 * are discarded before their half-open union is returned.
 */
export function detectDifferenceBounds(
  baseline: RgbaPixelBuffer,
  structural: RgbaPixelBuffer,
  options: DifferenceBoundsOptions = {},
): PixelBounds | null {
  validatePixelBuffer(baseline, 'baseline')
  validatePixelBuffer(structural, 'structural')
  if (
    baseline.width !== structural.width ||
    baseline.height !== structural.height
  ) {
    throw new RangeError('The baseline and structural renders must have equal dimensions.')
  }

  const differenceThreshold =
    options.differenceThreshold ?? DEFAULT_DIFFERENCE_THRESHOLD
  const minComponentPixels =
    options.minComponentPixels ?? DEFAULT_MIN_COMPONENT_PIXELS

  assertFiniteNonNegative(differenceThreshold, 'differenceThreshold')
  if (differenceThreshold > 255) {
    throw new RangeError('differenceThreshold must not exceed 255.')
  }
  assertPositiveInteger(minComponentPixels, 'minComponentPixels')

  const { width, height } = baseline
  const pixelCount = width * height
  const changed = new Uint8Array(pixelCount)

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const offset = pixelIndex * RGBA_CHANNELS_PER_PIXEL
    if (
      visibleRgbDifference(baseline.data, structural.data, offset) >
      differenceThreshold
    ) {
      changed[pixelIndex] = 1
    }
  }

  // A reusable typed queue keeps connected-component traversal predictable and
  // avoids creating an object for every changed pixel.
  const queue = new Uint32Array(pixelCount)
  let unionLeft = width
  let unionTop = height
  let unionRight = 0
  let unionBottom = 0
  let retainedAnyComponent = false

  for (let start = 0; start < pixelCount; start += 1) {
    if (changed[start] !== 1) continue

    let queueHead = 0
    let queueLength = 1
    queue[0] = start
    changed[start] = 2

    let componentPixels = 0
    let componentLeft = width
    let componentTop = height
    let componentRight = 0
    let componentBottom = 0

    while (queueHead < queueLength) {
      const pixelIndex = queue[queueHead]
      queueHead += 1
      const x = pixelIndex % width
      const y = Math.floor(pixelIndex / width)

      componentPixels += 1
      componentLeft = Math.min(componentLeft, x)
      componentTop = Math.min(componentTop, y)
      componentRight = Math.max(componentRight, x + 1)
      componentBottom = Math.max(componentBottom, y + 1)

      const neighbourLeft = Math.max(0, x - 1)
      const neighbourRight = Math.min(width - 1, x + 1)
      const neighbourTop = Math.max(0, y - 1)
      const neighbourBottom = Math.min(height - 1, y + 1)

      for (let neighbourY = neighbourTop; neighbourY <= neighbourBottom; neighbourY += 1) {
        const rowOffset = neighbourY * width
        for (
          let neighbourX = neighbourLeft;
          neighbourX <= neighbourRight;
          neighbourX += 1
        ) {
          const neighbourIndex = rowOffset + neighbourX
          if (changed[neighbourIndex] !== 1) continue
          changed[neighbourIndex] = 2
          queue[queueLength] = neighbourIndex
          queueLength += 1
        }
      }
    }

    if (componentPixels < minComponentPixels) continue

    retainedAnyComponent = true
    unionLeft = Math.min(unionLeft, componentLeft)
    unionTop = Math.min(unionTop, componentTop)
    unionRight = Math.max(unionRight, componentRight)
    unionBottom = Math.max(unionBottom, componentBottom)
  }

  if (!retainedAnyComponent) return null
  return {
    left: unionLeft,
    top: unionTop,
    right: unionRight,
    bottom: unionBottom,
  }
}

/** Clamps half-open pixel bounds to an image, returning null when disjoint. */
export function clampBounds(
  bounds: PixelBounds,
  imageWidth: number,
  imageHeight: number,
): PixelBounds | null {
  validateBounds(bounds)
  assertPositiveInteger(imageWidth, 'imageWidth')
  assertPositiveInteger(imageHeight, 'imageHeight')

  const left = Math.max(0, Math.min(imageWidth, bounds.left))
  const top = Math.max(0, Math.min(imageHeight, bounds.top))
  const right = Math.max(0, Math.min(imageWidth, bounds.right))
  const bottom = Math.max(0, Math.min(imageHeight, bounds.bottom))

  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom }
}

/** Expands bounds by an integer number of pixels and clamps them to the image. */
export function expandAndClampBounds(
  bounds: PixelBounds,
  paddingPixels: number,
  imageWidth: number,
  imageHeight: number,
): PixelBounds {
  validateBounds(bounds)
  assertFiniteNonNegative(paddingPixels, 'paddingPixels')
  if (!Number.isInteger(paddingPixels)) {
    throw new RangeError('paddingPixels must be an integer.')
  }

  const expanded = clampBounds(
    {
      left: bounds.left - paddingPixels,
      top: bounds.top - paddingPixels,
      right: bounds.right + paddingPixels,
      bottom: bounds.bottom + paddingPixels,
    },
    imageWidth,
    imageHeight,
  )

  if (!expanded) {
    throw new RangeError('The expanded bounds do not intersect the image.')
  }
  return expanded
}

/**
 * Conservatively maps crop bounds between differently sized renders of the
 * same page. Leading edges are floored and trailing edges are ceiled so no
 * source pixels are accidentally excluded.
 */
export function scaleBoundsBetweenViewports(
  bounds: PixelBounds,
  source: ViewportDimensions,
  target: ViewportDimensions,
): PixelBounds {
  validateBounds(bounds)
  validateDimensions(source, 'source')
  validateDimensions(target, 'target')

  const sourceBounds = clampBounds(bounds, source.width, source.height)
  if (!sourceBounds) {
    throw new RangeError('The source bounds do not intersect the source viewport.')
  }

  const scaleX = target.width / source.width
  const scaleY = target.height / source.height
  const scaled = clampBounds(
    {
      left: Math.floor(sourceBounds.left * scaleX),
      top: Math.floor(sourceBounds.top * scaleY),
      right: Math.ceil(sourceBounds.right * scaleX),
      bottom: Math.ceil(sourceBounds.bottom * scaleY),
    },
    target.width,
    target.height,
  )

  if (!scaled) {
    throw new RangeError('The scaled bounds do not intersect the target viewport.')
  }
  return scaled
}

/**
 * Converts real-world padding to pixels in an inspection render of a 1:N
 * drawing. Rounding up guarantees at least the requested metric margin.
 */
export function computeMetricPaddingPixels(
  paddingMetres: number,
  scaleDenominator: number,
  inspectionDpi: number,
): number {
  assertFiniteNonNegative(paddingMetres, 'paddingMetres')
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) {
    throw new RangeError('scaleDenominator must be a finite, positive number.')
  }
  if (!Number.isFinite(inspectionDpi) || inspectionDpi <= 0) {
    throw new RangeError('inspectionDpi must be a finite, positive number.')
  }

  const drawingMetresPerPixel =
    (scaleDenominator * MILLIMETRES_PER_INCH) / (inspectionDpi * 1000)
  return Math.ceil(paddingMetres / drawingMetresPerPixel)
}
