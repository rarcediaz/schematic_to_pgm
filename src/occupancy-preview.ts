import { OCCUPANCY_PALETTE } from './constants'
import type { RgbaPixelBuffer } from './occupancy'

export interface OccupancyPreviewMask {
  readonly width: number
  readonly height: number
  readonly pixels: ArrayLike<number>
  readonly roomMask: ArrayLike<number>
}

const EXTERIOR_PREVIEW_DARK = 48
const EXTERIOR_PREVIEW_LIGHT = 112
const ROOM_PREVIEW_DARK = 176
const ROOM_PREVIEW_LIGHT = 232

function visibleLuminance(data: ArrayLike<number>, offset: number): number {
  const red = data[offset] ?? 0
  const green = data[offset + 1] ?? 0
  const blue = data[offset + 2] ?? 0
  const alpha = (data[offset + 3] ?? 255) / 255
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue
  return luminance * alpha + 255 * (1 - alpha)
}

/**
 * Builds a display-only preview while leaving the exported trinary mask alone.
 * Indoor room detail is compressed into a light-gray range while exterior and
 * page detail use a darker band. This display transform does not alter the
 * navigation-safe bytes used by the exported occupancy map.
 */
export function composeOccupancyPreview(
  source: RgbaPixelBuffer,
  occupancy: OccupancyPreviewMask,
): Uint8ClampedArray {
  if (
    !Number.isSafeInteger(source.width) ||
    !Number.isSafeInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    source.width !== occupancy.width ||
    source.height !== occupancy.height
  ) {
    throw new RangeError('Source and occupancy preview dimensions must match.')
  }

  const pixelCount = source.width * source.height
  if (source.data.length !== pixelCount * 4) {
    throw new RangeError('Source preview data must contain four RGBA channels.')
  }
  if (occupancy.pixels.length !== pixelCount) {
    throw new RangeError('Occupancy preview data must contain one byte per pixel.')
  }
  if (occupancy.roomMask.length !== pixelCount) {
    throw new RangeError('Occupancy room mask must contain one byte per pixel.')
  }

  const output = new Uint8ClampedArray(pixelCount * 4)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const occupancyValue = occupancy.pixels[pixel]
    let previewValue: number
    if (occupancyValue === OCCUPANCY_PALETTE.free) {
      previewValue = 255
    } else if (occupancyValue === OCCUPANCY_PALETTE.occupied) {
      previewValue = 0
    } else if (occupancyValue === OCCUPANCY_PALETTE.excluded) {
      const sourceOffset = pixel * 4
      const luminance = visibleLuminance(source.data, sourceOffset)
      const isRoom = occupancy.roomMask[pixel] !== 0
      const dark = isRoom ? ROOM_PREVIEW_DARK : EXTERIOR_PREVIEW_DARK
      const light = isRoom ? ROOM_PREVIEW_LIGHT : EXTERIOR_PREVIEW_LIGHT
      previewValue = Math.round(
        dark + (luminance / 255) * (light - dark),
      )
    } else {
      throw new RangeError(`Unsupported occupancy preview value at pixel ${pixel}.`)
    }

    const outputOffset = pixel * 4
    output[outputOffset] = previewValue
    output[outputOffset + 1] = previewValue
    output[outputOffset + 2] = previewValue
    output[outputOffset + 3] = 255
  }
  return output
}
