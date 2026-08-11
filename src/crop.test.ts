import { describe, expect, it } from 'vitest'

import {
  clampBounds,
  computeMetricPaddingPixels,
  detectDifferenceBounds,
  expandAndClampBounds,
  scaleBoundsBetweenViewports,
  type RgbaPixelBuffer,
} from './crop'

function solidImage(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number] = [255, 255, 255, 255],
): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(rgba, pixel * 4)
  }
  return { width, height, data }
}

function paintPixel(
  image: RgbaPixelBuffer,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  const data = image.data as Uint8ClampedArray
  data.set(rgba, (y * image.width + x) * 4)
}

function paintRectangle(
  image: RgbaPixelBuffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  rgba: readonly [number, number, number, number] = [0, 0, 0, 255],
): void {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) paintPixel(image, x, y, rgba)
  }
}

describe('difference crop detection', () => {
  it('returns half-open bounds around retained structural components', () => {
    const baseline = solidImage(16, 12)
    const structural = solidImage(16, 12)
    paintRectangle(structural, 2, 3, 6, 6)
    paintRectangle(structural, 10, 7, 14, 10)

    expect(detectDifferenceBounds(baseline, structural)).toEqual({
      left: 2,
      top: 3,
      right: 14,
      bottom: 10,
    })
  })

  it('ignores small disconnected differences by default', () => {
    const baseline = solidImage(12, 10)
    const structural = solidImage(12, 10)
    paintRectangle(structural, 4, 2, 8, 5)
    paintPixel(structural, 0, 0, [0, 0, 0, 255])
    paintPixel(structural, 11, 9, [0, 0, 0, 255])

    expect(detectDifferenceBounds(baseline, structural)).toEqual({
      left: 4,
      top: 2,
      right: 8,
      bottom: 5,
    })
  })

  it('allows callers to retain single-pixel components', () => {
    const baseline = solidImage(5, 4)
    const structural = solidImage(5, 4)
    paintPixel(structural, 3, 1, [0, 0, 0, 255])

    expect(
      detectDifferenceBounds(baseline, structural, { minComponentPixels: 1 }),
    ).toEqual({ left: 3, top: 1, right: 4, bottom: 2 })
  })

  it('applies the visible-difference threshold after compositing over white', () => {
    const baseline = solidImage(10, 4)
    const structural = solidImage(10, 4)
    paintRectangle(structural, 1, 1, 5, 3, [240, 240, 240, 255])

    expect(detectDifferenceBounds(baseline, structural)).toBeNull()
    expect(
      detectDifferenceBounds(baseline, structural, {
        differenceThreshold: 10,
      }),
    ).toEqual({ left: 1, top: 1, right: 5, bottom: 3 })
  })

  it('ignores RGB changes that are fully transparent', () => {
    const baseline = solidImage(4, 3, [255, 255, 255, 0])
    const structural = solidImage(4, 3, [0, 0, 0, 0])

    expect(
      detectDifferenceBounds(baseline, structural, {
        differenceThreshold: 0,
        minComponentPixels: 1,
      }),
    ).toBeNull()
  })

  it('rejects mismatched image dimensions and incomplete RGBA data', () => {
    expect(() =>
      detectDifferenceBounds(solidImage(2, 2), solidImage(3, 2)),
    ).toThrow(/equal dimensions/)
    expect(() =>
      detectDifferenceBounds(
        solidImage(2, 2),
        { width: 2, height: 2, data: new Uint8Array(15) },
      ),
    ).toThrow(/four RGBA channels/)
  })
})

describe('crop bounds geometry', () => {
  it('clamps bounds to an image and rejects disjoint bounds', () => {
    expect(
      clampBounds({ left: -3, top: 2, right: 9, bottom: 12 }, 8, 10),
    ).toEqual({ left: 0, top: 2, right: 8, bottom: 10 })
    expect(
      clampBounds({ left: 12, top: 2, right: 15, bottom: 5 }, 8, 10),
    ).toBeNull()
  })

  it('expands symmetrically and clamps at page edges', () => {
    expect(
      expandAndClampBounds(
        { left: 2, top: 3, right: 8, bottom: 9 },
        4,
        12,
        10,
      ),
    ).toEqual({ left: 0, top: 0, right: 12, bottom: 10 })
  })

  it('scales conservatively between non-identical viewport sizes', () => {
    expect(
      scaleBoundsBetweenViewports(
        { left: 1, top: 2, right: 8, bottom: 7 },
        { width: 10, height: 10 },
        { width: 25, height: 15 },
      ),
    ).toEqual({ left: 2, top: 3, right: 20, bottom: 11 })
  })
})

describe('metric crop padding', () => {
  it('converts a real-world margin to inspection pixels and rounds up', () => {
    expect(computeMetricPaddingPixels(1, 250, 36)).toBe(6)
    expect(computeMetricPaddingPixels(1, 400, 36)).toBe(4)
    expect(computeMetricPaddingPixels(0, 250, 36)).toBe(0)
  })

  it('rejects invalid scale and DPI values', () => {
    expect(() => computeMetricPaddingPixels(1, 0, 36)).toThrow(
      /scaleDenominator/,
    )
    expect(() => computeMetricPaddingPixels(1, 250, Number.NaN)).toThrow(
      /inspectionDpi/,
    )
  })
})
