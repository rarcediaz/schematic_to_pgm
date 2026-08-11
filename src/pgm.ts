import {
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
  OCCUPANCY_PALETTE,
  PGM_MIME_TYPE,
} from './constants'

export interface RgbaImageData {
  readonly width: number
  readonly height: number
  readonly data: ArrayLike<number>
}

export interface TrinaryOccupancyData {
  readonly width: number
  readonly height: number
  readonly data: ArrayLike<number>
}

function assertImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PGM dimensions must be positive integers.')
  }
  if (
    width > MAX_OUTPUT_DIMENSION ||
    height > MAX_OUTPUT_DIMENSION ||
    width * height > MAX_OUTPUT_PIXELS
  ) {
    throw new Error('The image exceeds the supported output dimensions.')
  }
}

/** Returns one 8-bit luminance value after compositing RGBA over opaque white. */
export function grayscaleByte(
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): number {
  const opacity = alpha / 255
  const white = 255 * (1 - opacity)
  const compositedRed = red * opacity + white
  const compositedGreen = green * opacity + white
  const compositedBlue = blue * opacity + white

  return Math.round(
    0.299 * compositedRed + 0.587 * compositedGreen + 0.114 * compositedBlue,
  )
}

/** Creates the exact ASCII prefix required for a binary P5 PGM. */
export function createPgmHeader(width: number, height: number): string {
  assertImageDimensions(width, height)
  return `P5\n${width} ${height}\n255\n`
}

/** Encodes RGBA pixels as a real P5 byte stream (not Base64 or another image format). */
export function imageDataToPgmBytes(image: RgbaImageData): Uint8Array {
  const { width, height, data } = image
  assertImageDimensions(width, height)

  const pixelCount = width * height
  if (data.length !== pixelCount * 4) {
    throw new Error('RGBA data length does not match the image dimensions.')
  }

  const header = new TextEncoder().encode(createPgmHeader(width, height))
  const result = new Uint8Array(header.length + pixelCount)
  result.set(header)

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const source = pixel * 4
    result[header.length + pixel] = grayscaleByte(
      data[source] ?? 0,
      data[source + 1] ?? 0,
      data[source + 2] ?? 0,
      data[source + 3] ?? 0,
    )
  }

  return result
}

export function imageDataToPgmBlob(image: RgbaImageData): Blob {
  const bytes = imageDataToPgmBytes(image)
  return new Blob([bytes.buffer as ArrayBuffer], { type: PGM_MIME_TYPE })
}

/** Encodes a validated wall/excluded/free mask as an exact binary P5 PGM. */
export function occupancyDataToPgmBytes(
  image: TrinaryOccupancyData,
): Uint8Array {
  const { width, height, data } = image
  assertImageDimensions(width, height)
  const pixelCount = width * height
  if (data.length !== pixelCount) {
    throw new Error('Occupancy data length does not match the image dimensions.')
  }

  const header = new TextEncoder().encode(createPgmHeader(width, height))
  const result = new Uint8Array(header.length + pixelCount)
  result.set(header)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const value = data[pixel]
    if (
      value !== OCCUPANCY_PALETTE.occupied &&
      value !== OCCUPANCY_PALETTE.excluded &&
      value !== OCCUPANCY_PALETTE.free
    ) {
      throw new Error(
        `Occupancy pixel ${pixel.toLocaleString()} is not a wall, excluded space, or free space.`,
      )
    }
    result[header.length + pixel] = value
  }
  return result
}

export function occupancyDataToPgmBlob(
  image: TrinaryOccupancyData,
): Blob {
  const bytes = occupancyDataToPgmBytes(image)
  return new Blob([bytes.buffer as ArrayBuffer], { type: PGM_MIME_TYPE })
}

/** Reads the retained PDF preview canvas and returns a downloadable PGM Blob. */
export function canvasToPgmBlob(canvas: HTMLCanvasElement): Blob {
  assertImageDimensions(canvas.width, canvas.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('The browser could not read the PDF preview canvas.')
  }
  return imageDataToPgmBlob(
    context.getImageData(0, 0, canvas.width, canvas.height),
  )
}
