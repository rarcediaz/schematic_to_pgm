import { OCCUPANCY_PALETTE } from './constants'

export { OCCUPANCY_PALETTE } from './constants'

export interface RgbaPixelBuffer {
  readonly width: number
  readonly height: number
  readonly data: ArrayLike<number>
}

/** A closed-door barrier in output-canvas pixel coordinates. */
export interface PixelDoorSegment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
}

export interface OccupancyClassificationOptions {
  /** Physical output resolution in metres per pixel. */
  readonly resolution: number
  readonly doorSegments: readonly PixelDoorSegment[]
  /** Pixels at or below this visible luminance seed the sealed obstacle mask. */
  readonly strongDarkLuminanceMax?: number
  /** Pixels at or above this visible luminance participate in open components. */
  readonly nearWhiteLuminanceMin?: number
  /** Conservative obstacle expansion used to seal rasterisation gaps. */
  readonly sealRadiusMetres?: number
  /** Width assigned to supplied door segments before the topology seal. */
  readonly doorBarrierWidthMetres?: number
  /** Minimum distinct separating doors required by a hallway candidate. */
  readonly minDoorIncidence?: number
  /** Relative incidence cutoff used to retain split hallway components. */
  readonly relativeDoorIncidence?: number
  /** Minimum open component area in square metres. */
  readonly minComponentAreaMetresSquared?: number
  /** Maximum component area divided by its bounding-box area. */
  readonly maxBoundingBoxFillRatio?: number
  /** Minimum candidate bounding-box span in metres. */
  readonly minLongSideMetres?: number
  /** Largest enclosed white component fraction required for courtyard mode. */
  readonly courtyardMinImageFraction?: number
  /** Compactness required of the enclosed courtyard candidate. */
  readonly courtyardMinBoundingBoxFillRatio?: number
  /** Maximum separating-door incidence allowed for a courtyard. */
  readonly courtyardMaxDoorIncidence?: number
  /** Required size multiple over the next-largest enclosed component. */
  readonly courtyardDominanceRatio?: number
  /** Physical outward distance considered part of the courtyard annulus. */
  readonly courtyardProximityMetres?: number
  /** Minimum area of an annulus component or bounded edge subset. */
  readonly annulusMinAreaMetresSquared?: number
  /** Required fraction of a non-edge component inside the proximity mask. */
  readonly annulusMinProximityFraction?: number
  /** Elongation that independently qualifies an annulus component. */
  readonly annulusMinAspectRatio?: number
  /** Low-fill shape that independently qualifies an annulus component. */
  readonly annulusMaxBoundingBoxFillRatio?: number
  /** Maximum distance from selected free space at which obstacles render black. */
  readonly blackBoundaryMetres?: number
  /** Maximum thin, non-structural gray stroke width absorbed into free space. */
  readonly softTraceMaxWidthMetres?: number
  /** Minimum visible luminance eligible for thin drafting-trace absorption. */
  readonly softTraceLuminanceMin?: number
}

export type OccupancySelectionMode =
  | 'none'
  | 'components'
  | 'courtyard-annulus'

export interface OccupancyDiagnostics {
  readonly applied: boolean
  readonly selectionMode: OccupancySelectionMode
  readonly reason: string | null
  readonly componentCount: number
  readonly edgeComponentCount: number
  readonly candidateComponentCount: number
  readonly selectedComponentCount: number
  readonly suppliedDoorCount: number
  readonly separatingDoorCount: number
  readonly maximumDoorIncidence: number
  readonly dominantComponentTouchedEdge: boolean
  readonly courtyardDetected: boolean
  readonly courtyardPixelCount: number
  readonly courtyardImageFraction: number
  readonly courtyardBoundingBoxFillRatio: number
  readonly courtyardAnnulusPixelCount: number
  readonly sealedObstaclePixelCount: number
  readonly occupiedPixelCount: number
  readonly excludedPixelCount: number
  readonly freePixelCount: number
  readonly removedTracePixelCount: number
}

export interface OccupancyClassification {
  readonly width: number
  readonly height: number
  /** One exact trinary grayscale byte per source pixel. */
  readonly pixels: Uint8Array
  readonly diagnostics: OccupancyDiagnostics
}

interface ResolvedOptions {
  readonly resolution: number
  readonly doorSegments: readonly PixelDoorSegment[]
  readonly strongDarkLuminanceMax: number
  readonly nearWhiteLuminanceMin: number
  readonly sealRadiusPixels: number
  readonly doorRadiusPixels: number
  readonly minDoorIncidence: number
  readonly relativeDoorIncidence: number
  readonly minComponentAreaMetresSquared: number
  readonly maxBoundingBoxFillRatio: number
  readonly minLongSideMetres: number
  readonly courtyardMinImageFraction: number
  readonly courtyardMinBoundingBoxFillRatio: number
  readonly courtyardMaxDoorIncidence: number
  readonly courtyardDominanceRatio: number
  readonly courtyardProximityPixels: number
  readonly annulusMinAreaMetresSquared: number
  readonly annulusMinProximityFraction: number
  readonly annulusMinAspectRatio: number
  readonly annulusMaxBoundingBoxFillRatio: number
  readonly blackBoundaryPixels: number
  readonly softTraceMaxWidthPixels: number
  readonly softTraceLuminanceMin: number
}

interface Component {
  readonly id: number
  readonly seed: number
  readonly doorIds: Set<number>
  pixels: number
  left: number
  top: number
  right: number
  bottom: number
  touchesEdge: boolean
}

interface DoorSideReference {
  readonly doorIndex: number
  readonly side: 0 | 1
}

const DEFAULT_STRONG_DARK_LUMINANCE_MAX = 96
const DEFAULT_NEAR_WHITE_LUMINANCE_MIN = 224
const DEFAULT_SEAL_RADIUS_METRES = 0.05
const DEFAULT_DOOR_BARRIER_WIDTH_METRES = 0.1
const DEFAULT_MIN_DOOR_INCIDENCE = 10
const DEFAULT_RELATIVE_DOOR_INCIDENCE = 0.2
const DEFAULT_MIN_COMPONENT_AREA_METRES_SQUARED = 2.5
const DEFAULT_MAX_BOUNDING_BOX_FILL_RATIO = 0.6
const DEFAULT_MIN_LONG_SIDE_METRES = 0
const DEFAULT_COURTYARD_MIN_IMAGE_FRACTION = 0.25
const DEFAULT_COURTYARD_MIN_BOUNDING_BOX_FILL_RATIO = 0.85
const DEFAULT_COURTYARD_MAX_DOOR_INCIDENCE = 1
const DEFAULT_COURTYARD_DOMINANCE_RATIO = 1.5
const DEFAULT_COURTYARD_PROXIMITY_METRES = 3
const DEFAULT_ANNULUS_MIN_AREA_METRES_SQUARED = 1.25
const DEFAULT_ANNULUS_MIN_PROXIMITY_FRACTION = 0.65
const DEFAULT_ANNULUS_MIN_ASPECT_RATIO = 2
const DEFAULT_ANNULUS_MAX_BOUNDING_BOX_FILL_RATIO = 0.6
const DEFAULT_BLACK_BOUNDARY_METRES = 0.15
const DEFAULT_SOFT_TRACE_MAX_WIDTH_METRES = 0.15
const DEFAULT_SOFT_TRACE_LUMINANCE_MIN = 216
const MAX_SEAL_RADIUS_PIXELS = 2
const MAX_DOOR_RADIUS_PIXELS = 3
const MAX_BLACK_BOUNDARY_PIXELS = 6
const MAX_SOFT_TRACE_WIDTH_PIXELS = 3

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`)
  }
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite, positive number.`)
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative number.`)
  }
}

function resolveOptions(
  options: OccupancyClassificationOptions,
): ResolvedOptions {
  assertFinitePositive(options.resolution, 'resolution')

  const strongDarkLuminanceMax =
    options.strongDarkLuminanceMax ?? DEFAULT_STRONG_DARK_LUMINANCE_MAX
  const nearWhiteLuminanceMin =
    options.nearWhiteLuminanceMin ?? DEFAULT_NEAR_WHITE_LUMINANCE_MIN
  assertFiniteNonNegative(
    strongDarkLuminanceMax,
    'strongDarkLuminanceMax',
  )
  assertFiniteNonNegative(nearWhiteLuminanceMin, 'nearWhiteLuminanceMin')
  if (
    strongDarkLuminanceMax > 255 ||
    nearWhiteLuminanceMin > 255 ||
    strongDarkLuminanceMax >= nearWhiteLuminanceMin
  ) {
    throw new RangeError(
      'Luminance thresholds must be within 0..255 with strong dark below near white.',
    )
  }

  const sealRadiusMetres =
    options.sealRadiusMetres ?? DEFAULT_SEAL_RADIUS_METRES
  const doorBarrierWidthMetres =
    options.doorBarrierWidthMetres ?? DEFAULT_DOOR_BARRIER_WIDTH_METRES
  const minDoorIncidence =
    options.minDoorIncidence ?? DEFAULT_MIN_DOOR_INCIDENCE
  const relativeDoorIncidence =
    options.relativeDoorIncidence ?? DEFAULT_RELATIVE_DOOR_INCIDENCE
  const minComponentAreaMetresSquared =
    options.minComponentAreaMetresSquared ??
    DEFAULT_MIN_COMPONENT_AREA_METRES_SQUARED
  const maxBoundingBoxFillRatio =
    options.maxBoundingBoxFillRatio ?? DEFAULT_MAX_BOUNDING_BOX_FILL_RATIO
  const minLongSideMetres =
    options.minLongSideMetres ?? DEFAULT_MIN_LONG_SIDE_METRES
  const courtyardMinImageFraction =
    options.courtyardMinImageFraction ??
    DEFAULT_COURTYARD_MIN_IMAGE_FRACTION
  const courtyardMinBoundingBoxFillRatio =
    options.courtyardMinBoundingBoxFillRatio ??
    DEFAULT_COURTYARD_MIN_BOUNDING_BOX_FILL_RATIO
  const courtyardMaxDoorIncidence =
    options.courtyardMaxDoorIncidence ??
    DEFAULT_COURTYARD_MAX_DOOR_INCIDENCE
  const courtyardDominanceRatio =
    options.courtyardDominanceRatio ?? DEFAULT_COURTYARD_DOMINANCE_RATIO
  const courtyardProximityMetres =
    options.courtyardProximityMetres ?? DEFAULT_COURTYARD_PROXIMITY_METRES
  const annulusMinAreaMetresSquared =
    options.annulusMinAreaMetresSquared ??
    DEFAULT_ANNULUS_MIN_AREA_METRES_SQUARED
  const annulusMinProximityFraction =
    options.annulusMinProximityFraction ??
    DEFAULT_ANNULUS_MIN_PROXIMITY_FRACTION
  const annulusMinAspectRatio =
    options.annulusMinAspectRatio ?? DEFAULT_ANNULUS_MIN_ASPECT_RATIO
  const annulusMaxBoundingBoxFillRatio =
    options.annulusMaxBoundingBoxFillRatio ??
    DEFAULT_ANNULUS_MAX_BOUNDING_BOX_FILL_RATIO
  const blackBoundaryMetres =
    options.blackBoundaryMetres ?? DEFAULT_BLACK_BOUNDARY_METRES
  const softTraceMaxWidthMetres =
    options.softTraceMaxWidthMetres ?? DEFAULT_SOFT_TRACE_MAX_WIDTH_METRES
  const configuredSoftTraceLuminanceMin = options.softTraceLuminanceMin
  const softTraceLuminanceMin =
    configuredSoftTraceLuminanceMin ??
    Math.max(
      0,
      Math.min(
        DEFAULT_SOFT_TRACE_LUMINANCE_MIN,
        nearWhiteLuminanceMin - 1,
      ),
    )

  assertFiniteNonNegative(sealRadiusMetres, 'sealRadiusMetres')
  assertFinitePositive(doorBarrierWidthMetres, 'doorBarrierWidthMetres')
  if (!Number.isSafeInteger(minDoorIncidence) || minDoorIncidence <= 0) {
    throw new RangeError('minDoorIncidence must be a positive integer.')
  }
  assertFinitePositive(relativeDoorIncidence, 'relativeDoorIncidence')
  if (relativeDoorIncidence > 1) {
    throw new RangeError('relativeDoorIncidence must not exceed 1.')
  }
  assertFiniteNonNegative(
    minComponentAreaMetresSquared,
    'minComponentAreaMetresSquared',
  )
  assertFinitePositive(maxBoundingBoxFillRatio, 'maxBoundingBoxFillRatio')
  if (maxBoundingBoxFillRatio > 1) {
    throw new RangeError('maxBoundingBoxFillRatio must not exceed 1.')
  }
  assertFiniteNonNegative(minLongSideMetres, 'minLongSideMetres')
  assertFinitePositive(courtyardMinImageFraction, 'courtyardMinImageFraction')
  if (courtyardMinImageFraction > 1) {
    throw new RangeError('courtyardMinImageFraction must not exceed 1.')
  }
  assertFinitePositive(
    courtyardMinBoundingBoxFillRatio,
    'courtyardMinBoundingBoxFillRatio',
  )
  if (courtyardMinBoundingBoxFillRatio > 1) {
    throw new RangeError(
      'courtyardMinBoundingBoxFillRatio must not exceed 1.',
    )
  }
  if (
    !Number.isSafeInteger(courtyardMaxDoorIncidence) ||
    courtyardMaxDoorIncidence < 0
  ) {
    throw new RangeError(
      'courtyardMaxDoorIncidence must be a non-negative integer.',
    )
  }
  assertFinitePositive(courtyardDominanceRatio, 'courtyardDominanceRatio')
  if (courtyardDominanceRatio < 1) {
    throw new RangeError('courtyardDominanceRatio must be at least 1.')
  }
  assertFinitePositive(courtyardProximityMetres, 'courtyardProximityMetres')
  assertFiniteNonNegative(
    annulusMinAreaMetresSquared,
    'annulusMinAreaMetresSquared',
  )
  assertFinitePositive(
    annulusMinProximityFraction,
    'annulusMinProximityFraction',
  )
  if (annulusMinProximityFraction > 1) {
    throw new RangeError('annulusMinProximityFraction must not exceed 1.')
  }
  assertFinitePositive(annulusMinAspectRatio, 'annulusMinAspectRatio')
  if (annulusMinAspectRatio < 1) {
    throw new RangeError('annulusMinAspectRatio must be at least 1.')
  }
  assertFinitePositive(
    annulusMaxBoundingBoxFillRatio,
    'annulusMaxBoundingBoxFillRatio',
  )
  if (annulusMaxBoundingBoxFillRatio > 1) {
    throw new RangeError('annulusMaxBoundingBoxFillRatio must not exceed 1.')
  }
  assertFinitePositive(blackBoundaryMetres, 'blackBoundaryMetres')
  assertFiniteNonNegative(
    softTraceMaxWidthMetres,
    'softTraceMaxWidthMetres',
  )
  assertFiniteNonNegative(softTraceLuminanceMin, 'softTraceLuminanceMin')
  const hasSoftTraceLuminanceBand =
    softTraceLuminanceMin > strongDarkLuminanceMax &&
    softTraceLuminanceMin < nearWhiteLuminanceMin
  if (
    configuredSoftTraceLuminanceMin !== undefined &&
    !hasSoftTraceLuminanceBand
  ) {
    throw new RangeError(
      'softTraceLuminanceMin must be above strong dark and below near white.',
    )
  }

  for (const [index, segment] of options.doorSegments.entries()) {
    const coordinates = [segment.ax, segment.ay, segment.bx, segment.by]
    if (!coordinates.every(Number.isFinite)) {
      throw new RangeError(`doorSegments[${index}] must have finite coordinates.`)
    }
    if (Math.hypot(segment.bx - segment.ax, segment.by - segment.ay) < 0.5) {
      throw new RangeError(`doorSegments[${index}] must have a visible length.`)
    }
  }

  const resolution = options.resolution
  const sealRadiusPixels = Math.min(
    MAX_SEAL_RADIUS_PIXELS,
    Math.ceil(sealRadiusMetres / resolution),
  )
  const requestedDoorWidthPixels = doorBarrierWidthMetres / resolution
  const doorRadiusPixels = Math.min(
    MAX_DOOR_RADIUS_PIXELS,
    Math.max(0, Math.ceil((requestedDoorWidthPixels - 1) / 2)),
  )

  return {
    resolution,
    doorSegments: options.doorSegments,
    strongDarkLuminanceMax,
    nearWhiteLuminanceMin,
    sealRadiusPixels,
    doorRadiusPixels,
    minDoorIncidence,
    relativeDoorIncidence,
    minComponentAreaMetresSquared,
    maxBoundingBoxFillRatio,
    minLongSideMetres,
    courtyardMinImageFraction,
    courtyardMinBoundingBoxFillRatio,
    courtyardMaxDoorIncidence,
    courtyardDominanceRatio,
    courtyardProximityPixels: Math.ceil(
      courtyardProximityMetres / resolution,
    ),
    annulusMinAreaMetresSquared,
    annulusMinProximityFraction,
    annulusMinAspectRatio,
    annulusMaxBoundingBoxFillRatio,
    blackBoundaryPixels: Math.min(
      MAX_BLACK_BOUNDARY_PIXELS,
      Math.max(1, Math.ceil(blackBoundaryMetres / resolution)),
    ),
    softTraceMaxWidthPixels: hasSoftTraceLuminanceBand
      ? Math.min(
          MAX_SOFT_TRACE_WIDTH_PIXELS,
          Math.ceil(softTraceMaxWidthMetres / resolution),
        )
      : 0,
    softTraceLuminanceMin,
  }
}

function validateImage(image: RgbaPixelBuffer): number {
  assertPositiveInteger(image.width, 'image.width')
  assertPositiveInteger(image.height, 'image.height')
  const pixelCount = image.width * image.height
  const requiredLength = pixelCount * 4
  if (
    !Number.isSafeInteger(pixelCount) ||
    !Number.isSafeInteger(requiredLength) ||
    image.data.length < requiredLength
  ) {
    throw new RangeError(
      'image.data must contain four RGBA channels for every pixel.',
    )
  }
  return pixelCount
}

function visibleLuminance(data: ArrayLike<number>, offset: number): number {
  const alpha = Math.max(0, Math.min(255, data[offset + 3] ?? 0)) / 255
  const white = 255 * (1 - alpha)
  const red = Math.max(0, Math.min(255, data[offset] ?? 0)) * alpha + white
  const green =
    Math.max(0, Math.min(255, data[offset + 1] ?? 0)) * alpha + white
  const blue =
    Math.max(0, Math.min(255, data[offset + 2] ?? 0)) * alpha + white
  return 0.299 * red + 0.587 * green + 0.114 * blue
}

function paintSquare(
  mask: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const left = Math.max(0, centerX - radius)
  const right = Math.min(width - 1, centerX + radius)
  const top = Math.max(0, centerY - radius)
  const bottom = Math.min(height - 1, centerY + radius)
  for (let y = top; y <= bottom; y += 1) {
    const row = y * width
    mask.fill(1, row + left, row + right + 1)
  }
}

function paintDoorSegment(
  mask: Uint8Array,
  width: number,
  height: number,
  segment: PixelDoorSegment,
  radius: number,
): void {
  const dx = segment.bx - segment.ax
  const dy = segment.by - segment.ay
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))))
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps
    const x = Math.round(segment.ax + dx * ratio)
    const y = Math.round(segment.ay + dy * ratio)
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    paintSquare(mask, width, height, x, y, radius)
  }
}

function createSealedObstacleMask(
  image: RgbaPixelBuffer,
  options: ResolvedOptions,
): Uint8Array {
  const { width, height, data } = image
  const obstacles = new Uint8Array(width * height)

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const index = row + x
      if (
        visibleLuminance(data, index * 4) <=
        options.strongDarkLuminanceMax
      ) {
        paintSquare(
          obstacles,
          width,
          height,
          x,
          y,
          options.sealRadiusPixels,
        )
      }
    }
  }

  const doorRadius = options.doorRadiusPixels + options.sealRadiusPixels
  for (const segment of options.doorSegments) {
    paintDoorSegment(obstacles, width, height, segment, doorRadius)
  }
  return obstacles
}

function createOpenState(
  image: RgbaPixelBuffer,
  obstacles: Uint8Array,
  nearWhiteLuminanceMin: number,
): Uint8Array {
  const state = new Uint8Array(obstacles.length)
  for (let index = 0; index < obstacles.length; index += 1) {
    if (
      obstacles[index] === 0 &&
      visibleLuminance(image.data, index * 4) >= nearWhiteLuminanceMin
    ) {
      state[index] = 1
    }
  }
  return state
}

/**
 * Four-connected scanline flood fill. The stack holds row spans rather than
 * every pixel, keeping memory bounded on the large white regions in SFU sheets.
 */
function floodScanline(
  state: Uint8Array,
  width: number,
  height: number,
  seed: number,
  from: number,
  to: number,
  visit?: (index: number, x: number, y: number) => void,
): number {
  if (state[seed] !== from) return 0
  const stack: number[] = [seed]
  let changed = 0

  while (stack.length > 0) {
    const pending = stack.pop()
    if (pending === undefined || state[pending] !== from) continue
    const y = Math.floor(pending / width)
    let x = pending - y * width
    let index = pending
    while (x > 0 && state[index - 1] === from) {
      x -= 1
      index -= 1
    }

    let aboveSpan = false
    let belowSpan = false
    while (x < width && state[index] === from) {
      state[index] = to
      changed += 1
      visit?.(index, x, y)

      if (y > 0) {
        const above = index - width
        if (state[above] === from) {
          if (!aboveSpan) stack.push(above)
          aboveSpan = true
        } else {
          aboveSpan = false
        }
      }
      if (y + 1 < height) {
        const below = index + width
        if (state[below] === from) {
          if (!belowSpan) stack.push(below)
          belowSpan = true
        } else {
          belowSpan = false
        }
      }

      x += 1
      index += 1
    }
  }
  return changed
}

function sampleDoorSidePixels(
  segment: PixelDoorSegment,
  sign: -1 | 1,
  state: Uint8Array,
  width: number,
  height: number,
  options: ResolvedOptions,
): number[] {
  const dx = segment.bx - segment.ax
  const dy = segment.by - segment.ay
  const length = Math.hypot(dx, dy)
  const normalX = (-dy / length) * sign
  const normalY = (dx / length) * sign
  const minimumOffset =
    options.doorRadiusPixels + options.sealRadiusPixels + 1
  const offsets = new Set<number>([minimumOffset])
  for (const metres of [0.2, 0.3, 0.4, 0.55, 0.75, 1]) {
    offsets.add(Math.max(minimumOffset, Math.ceil(metres / options.resolution)))
  }
  const samples = new Set<number>()
  for (const fraction of [0.3, 0.5, 0.7]) {
    const leafX = segment.ax + dx * fraction
    const leafY = segment.ay + dy * fraction
    for (const offset of offsets) {
      const x = Math.round(leafX + normalX * offset)
      const y = Math.round(leafY + normalY * offset)
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const index = y * width + x
      if (state[index] === 1) samples.add(index)
    }
  }
  return [...samples]
}

function modalComponent(votes: ReadonlyMap<number, number>): number {
  let selected = -1
  let selectedVotes = 0
  for (const [componentId, count] of votes) {
    if (
      count > selectedVotes ||
      (count === selectedVotes && (selected < 0 || componentId < selected))
    ) {
      selected = componentId
      selectedVotes = count
    }
  }
  return selected
}

function compareCandidates(first: Component, second: Component): number {
  if (first.doorIds.size !== second.doorIds.size) {
    return second.doorIds.size - first.doorIds.size
  }
  const firstLongSide = Math.max(
    first.right - first.left,
    first.bottom - first.top,
  )
  const secondLongSide = Math.max(
    second.right - second.left,
    second.bottom - second.top,
  )
  if (firstLongSide !== secondLongSide) return secondLongSide - firstLongSide
  return second.pixels - first.pixels
}

function componentBoundingBoxPixels(component: Component): number {
  return (
    (component.right - component.left) *
    (component.bottom - component.top)
  )
}

function componentFillRatio(component: Component): number {
  return component.pixels / componentBoundingBoxPixels(component)
}

function componentAspectRatio(component: Component): number {
  const width = component.right - component.left
  const height = component.bottom - component.top
  return Math.max(width, height) / Math.max(1, Math.min(width, height))
}

function createCourtyardProximityMask(
  state: Uint8Array,
  width: number,
  height: number,
  courtyard: Component,
  radius: number,
): Uint8Array {
  floodScanline(state, width, height, courtyard.seed, 2, 4)
  const proximity = new Uint8Array(state.length)
  let frontier: number[] = []

  for (let index = 0; index < state.length; index += 1) {
    if (state[index] !== 4) continue
    proximity[index] = 1
    const y = Math.floor(index / width)
    const x = index - y * width
    if (
      (x > 0 && state[index - 1] !== 4) ||
      (x + 1 < width && state[index + 1] !== 4) ||
      (y > 0 && state[index - width] !== 4) ||
      (y + 1 < height && state[index + width] !== 4)
    ) {
      frontier.push(index)
    }
  }

  for (let distance = 0; distance < radius && frontier.length > 0; distance += 1) {
    const next: number[] = []
    for (const index of frontier) {
      const y = Math.floor(index / width)
      const x = index - y * width
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ]
      for (const neighbour of neighbours) {
        if (neighbour < 0 || proximity[neighbour] !== 0) continue
        proximity[neighbour] = 1
        next.push(neighbour)
      }
    }
    frontier = next
  }
  return proximity
}

interface ProximityStats {
  pixels: number
  left: number
  top: number
  right: number
  bottom: number
}

function inspectComponentProximity(
  state: Uint8Array,
  proximity: Uint8Array,
  width: number,
  height: number,
  component: Component,
): ProximityStats {
  const stats: ProximityStats = {
    pixels: 0,
    left: width,
    top: height,
    right: 0,
    bottom: 0,
  }
  floodScanline(state, width, height, component.seed, 2, 5, (index, x, y) => {
    if (proximity[index] === 0) return
    stats.pixels += 1
    stats.left = Math.min(stats.left, x)
    stats.top = Math.min(stats.top, y)
    stats.right = Math.max(stats.right, x + 1)
    stats.bottom = Math.max(stats.bottom, y + 1)
  })
  return stats
}

function proximityStatsHaveCorridorShape(
  stats: ProximityStats,
  options: ResolvedOptions,
): boolean {
  if (stats.pixels === 0) return false
  const width = stats.right - stats.left
  const height = stats.bottom - stats.top
  const boundingBoxPixels = width * height
  const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height))
  const fillRatio = stats.pixels / boundingBoxPixels
  return (
    aspectRatio >= options.annulusMinAspectRatio ||
    fillRatio <= options.annulusMaxBoundingBoxFillRatio
  )
}

function isObstacleAdjacentToSelected(
  obstacleIndex: number,
  state: Uint8Array,
  width: number,
  height: number,
  radius: number,
): boolean {
  const y = Math.floor(obstacleIndex / width)
  const x = obstacleIndex - y * width
  const left = Math.max(0, x - radius)
  const right = Math.min(width - 1, x + radius)
  const top = Math.max(0, y - radius)
  const bottom = Math.min(height - 1, y + radius)
  for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
    const row = sampleY * width
    for (let sampleX = left; sampleX <= right; sampleX += 1) {
      if (state[row + sampleX] === 3) return true
    }
  }
  return false
}

/**
 * Removes thin pale-gray drafting overlays only when selected free space exists
 * on opposite sides. Structural pixels are never promoted, and the search
 * stops at an unselected open component so this cannot grow into a room.
 */
function absorbSoftTraces(
  image: RgbaPixelBuffer,
  state: Uint8Array,
  obstacles: Uint8Array,
  width: number,
  height: number,
  maxWidth: number,
  minimumLuminance: number,
): number {
  if (maxWidth <= 0) return 0
  const promoted = new Uint8Array(state.length)

  const reachesSelected = (
    x: number,
    y: number,
    stepX: number,
    stepY: number,
  ): boolean => {
    for (let distance = 1; distance <= maxWidth; distance += 1) {
      const sampleX = x + stepX * distance
      const sampleY = y + stepY * distance
      if (
        sampleX < 0 ||
        sampleY < 0 ||
        sampleX >= width ||
        sampleY >= height
      ) {
        return false
      }
      const sample = sampleY * width + sampleX
      if (obstacles[sample] !== 0) return false
      if (state[sample] === 3) return true
      if (state[sample] !== 0) return false
    }
    return false
  }

  for (let y = 0; y < height; y += 1) {
    const row = y * width
    for (let x = 0; x < width; x += 1) {
      const index = row + x
      if (state[index] !== 0 || obstacles[index] !== 0) continue
      if (visibleLuminance(image.data, index * 4) < minimumLuminance) continue
      const horizontallyEnclosed =
        reachesSelected(x, y, -1, 0) && reachesSelected(x, y, 1, 0)
      const verticallyEnclosed =
        reachesSelected(x, y, 0, -1) && reachesSelected(x, y, 0, 1)
      if (horizontallyEnclosed || verticallyEnclosed) promoted[index] = 1
    }
  }

  let removed = 0
  for (let index = 0; index < promoted.length; index += 1) {
    if (promoted[index] === 0) continue
    state[index] = 3
    removed += 1
  }
  return removed
}

/**
 * Produces a conservative hallway-only trinary occupancy raster.
 *
 * White components are ranked by the number of distinct closed doors separating
 * them from other components. If the dominant candidate touches the crop edge,
 * classification fails closed instead of risking an exterior region becoming
 * navigable free space.
 */
export function classifyMainHallways(
  image: RgbaPixelBuffer,
  rawOptions: OccupancyClassificationOptions,
): OccupancyClassification {
  const pixelCount = validateImage(image)
  const options = resolveOptions(rawOptions)
  const { width, height } = image
  const obstacles = createSealedObstacleMask(image, options)
  const state = createOpenState(
    image,
    obstacles,
    options.nearWhiteLuminanceMin,
  )

  const sampleReferences = new Map<number, DoorSideReference[]>()
  for (const [doorIndex, segment] of options.doorSegments.entries()) {
    const first = sampleDoorSidePixels(
      segment,
      -1,
      state,
      width,
      height,
      options,
    )
    const second = sampleDoorSidePixels(
      segment,
      1,
      state,
      width,
      height,
      options,
    )
    for (const [side, samples] of [first, second].entries()) {
      for (const sample of samples) {
        const references = sampleReferences.get(sample) ?? []
        references.push({ doorIndex, side: side as 0 | 1 })
        sampleReferences.set(sample, references)
      }
    }
  }

  const doorSideVotes: Array<
    [Map<number, number>, Map<number, number>]
  > = options.doorSegments.map(
    () => [new Map<number, number>(), new Map<number, number>()],
  )
  const components: Component[] = []
  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (state[seed] !== 1) continue
    const component: Component = {
      id: components.length,
      seed,
      doorIds: new Set<number>(),
      pixels: 0,
      left: width,
      top: height,
      right: 0,
      bottom: 0,
      touchesEdge: false,
    }
    floodScanline(state, width, height, seed, 1, 2, (index, x, y) => {
      component.pixels += 1
      component.left = Math.min(component.left, x)
      component.top = Math.min(component.top, y)
      component.right = Math.max(component.right, x + 1)
      component.bottom = Math.max(component.bottom, y + 1)
      component.touchesEdge ||=
        x === 0 || y === 0 || x + 1 === width || y + 1 === height
      for (const reference of sampleReferences.get(index) ?? []) {
        const votes = doorSideVotes[reference.doorIndex][reference.side]
        votes.set(component.id, (votes.get(component.id) ?? 0) + 1)
      }
    })
    components.push(component)
  }

  const doorSideComponents: Array<[number, number]> = doorSideVotes.map(
    ([first, second]) => [modalComponent(first), modalComponent(second)],
  )

  let separatingDoorCount = 0
  for (let doorIndex = 0; doorIndex < doorSideComponents.length; doorIndex += 1) {
    const [first, second] = doorSideComponents[doorIndex]
    if (first < 0 || second < 0 || first === second) continue
    separatingDoorCount += 1
    components[first]?.doorIds.add(doorIndex)
    components[second]?.doorIds.add(doorIndex)
  }

  const enclosedByArea = components
    .filter((component) => !component.touchesEdge)
    .sort((first, second) => second.pixels - first.pixels)
  const courtyard = enclosedByArea[0] ?? null
  const courtyardRunnerUp = enclosedByArea[1] ?? null
  const courtyardImageFraction = courtyard
    ? courtyard.pixels / pixelCount
    : 0
  const courtyardBoundingBoxFillRatio = courtyard
    ? componentFillRatio(courtyard)
    : 0
  const courtyardDominance = courtyard
    ? courtyard.pixels / Math.max(1, courtyardRunnerUp?.pixels ?? 0)
    : 0
  const courtyardDetected = Boolean(
    courtyard &&
      courtyardImageFraction >= options.courtyardMinImageFraction &&
      courtyardBoundingBoxFillRatio >=
        options.courtyardMinBoundingBoxFillRatio &&
      courtyard.doorIds.size <= options.courtyardMaxDoorIncidence &&
      courtyardDominance >= options.courtyardDominanceRatio,
  )

  const geometricallyEligible = components
    .filter((component) => {
      const longSideMetres =
        Math.max(
          component.right - component.left,
          component.bottom - component.top,
        ) * options.resolution
      const areaMetresSquared =
        component.pixels * options.resolution * options.resolution
      const boundingBoxPixels =
        (component.right - component.left) *
        (component.bottom - component.top)
      const boundingBoxFillRatio = component.pixels / boundingBoxPixels
      return (
        areaMetresSquared >= options.minComponentAreaMetresSquared &&
        longSideMetres >= options.minLongSideMetres &&
        boundingBoxFillRatio <= options.maxBoundingBoxFillRatio
      )
    })
    .sort(compareCandidates)

  const maximumDoorIncidence = Math.max(
    0,
    ...components.map((component) => component.doorIds.size),
  )
  const incidenceCutoff = Math.max(
    options.minDoorIncidence,
    Math.ceil(maximumDoorIncidence * options.relativeDoorIncidence),
  )
  const dominantHighDoorComponent = components
    .filter(
      (component) =>
        component.doorIds.size >= incidenceCutoff &&
        component.pixels * options.resolution * options.resolution >=
          options.minComponentAreaMetresSquared,
    )
    .sort(compareCandidates)[0] ?? null
  const candidates = geometricallyEligible.filter(
    (component) => component.doorIds.size >= incidenceCutoff,
  )
  const unsafeDominant = dominantHighDoorComponent?.touchesEdge === true
  let selectedComponentCount = 0
  let candidateComponentCount = candidates.length
  let courtyardAnnulusPixelCount = 0

  if (courtyardDetected && courtyard) {
    const proximity = createCourtyardProximityMask(
      state,
      width,
      height,
      courtyard,
      options.courtyardProximityPixels,
    )
    candidateComponentCount = 0

    for (const component of components) {
      if (component.id === courtyard.id || state[component.seed] !== 2) continue
      const proximityStats = inspectComponentProximity(
        state,
        proximity,
        width,
        height,
        component,
      )
      const componentArea =
        component.pixels * options.resolution * options.resolution
      const componentHasCorridorShape =
        componentAspectRatio(component) >= options.annulusMinAspectRatio ||
        componentFillRatio(component) <=
          options.annulusMaxBoundingBoxFillRatio
      const selectWholeComponent =
        !component.touchesEdge &&
        componentArea >= options.annulusMinAreaMetresSquared &&
        proximityStats.pixels / component.pixels >=
          options.annulusMinProximityFraction &&
        componentHasCorridorShape
      const proximityArea =
        proximityStats.pixels * options.resolution * options.resolution
      const selectBoundedEdgeSubset =
        component.touchesEdge &&
        proximityArea >= options.annulusMinAreaMetresSquared &&
        proximityStatsHaveCorridorShape(proximityStats, options)

      if (selectWholeComponent) {
        candidateComponentCount += 1
        selectedComponentCount += 1
        courtyardAnnulusPixelCount += floodScanline(
          state,
          width,
          height,
          component.seed,
          5,
          3,
        )
      } else if (selectBoundedEdgeSubset) {
        candidateComponentCount += 1
        selectedComponentCount += 1
        floodScanline(state, width, height, component.seed, 5, 2, (index) => {
          if (proximity[index] === 0) return
          state[index] = 3
          courtyardAnnulusPixelCount += 1
        })
      } else {
        floodScanline(state, width, height, component.seed, 5, 2)
      }
    }
  } else if (!unsafeDominant) {
    const selectedComponents = candidates.filter(
      (component) => !component.touchesEdge,
    )
    selectedComponentCount = selectedComponents.length
    for (const component of selectedComponents) {
      floodScanline(state, width, height, component.seed, 2, 3)
    }
  }

  const removedTracePixelCount = absorbSoftTraces(
    image,
    state,
    obstacles,
    width,
    height,
    options.softTraceMaxWidthPixels,
    options.softTraceLuminanceMin,
  )

  const pixels = new Uint8Array(pixelCount)
  pixels.fill(OCCUPANCY_PALETTE.excluded)
  let freePixelCount = 0
  for (let index = 0; index < pixelCount; index += 1) {
    if (state[index] !== 3) continue
    pixels[index] = OCCUPANCY_PALETTE.free
    freePixelCount += 1
  }

  let occupiedPixelCount = 0
  let sealedObstaclePixelCount = 0
  for (let index = 0; index < pixelCount; index += 1) {
    if (obstacles[index] === 0) continue
    sealedObstaclePixelCount += 1
    if (
      isObstacleAdjacentToSelected(
        index,
        state,
        width,
        height,
        options.blackBoundaryPixels,
      )
    ) {
      pixels[index] = OCCUPANCY_PALETTE.occupied
      occupiedPixelCount += 1
    }
  }

  const selectionMode: OccupancySelectionMode =
    freePixelCount === 0
      ? 'none'
      : courtyardDetected
        ? 'courtyard-annulus'
        : 'components'
  const applied = freePixelCount > 0
  const reason = applied
    ? null
    : courtyardDetected
      ? 'A dominant enclosed courtyard was detected, but no safe nearby corridor component passed the annulus gates.'
      : unsafeDominant
      ? 'The dominant hallway candidate reached the crop edge; classification was withheld to avoid marking exterior space as free.'
      : candidates.length === 0
        ? 'No open component passed the hallway area, shape, and closed-door incidence gates.'
        : 'No hallway component passed the conservative selection gate.'

  return {
    width,
    height,
    pixels,
    diagnostics: {
      applied,
      selectionMode,
      reason,
      componentCount: components.length,
      edgeComponentCount: components.filter((component) => component.touchesEdge)
        .length,
      candidateComponentCount,
      selectedComponentCount,
      suppliedDoorCount: options.doorSegments.length,
      separatingDoorCount,
      maximumDoorIncidence,
      dominantComponentTouchedEdge:
        dominantHighDoorComponent?.touchesEdge ?? false,
      courtyardDetected,
      courtyardPixelCount: courtyard?.pixels ?? 0,
      courtyardImageFraction,
      courtyardBoundingBoxFillRatio,
      courtyardAnnulusPixelCount,
      sealedObstaclePixelCount,
      occupiedPixelCount,
      excludedPixelCount: pixelCount - freePixelCount - occupiedPixelCount,
      freePixelCount,
      removedTracePixelCount,
    },
  }
}

/** Backwards-readable alias for callers that prefer the result noun. */
export const classifyHallwayOccupancy = classifyMainHallways
