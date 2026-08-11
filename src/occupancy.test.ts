import { describe, expect, it } from 'vitest'

import {
  OCCUPANCY_PALETTE,
  classifyMainHallways,
  type OccupancyClassificationOptions,
  type PixelDoorSegment,
  type RgbaPixelBuffer,
} from './occupancy'

const BLACK = [0, 0, 0, 255] as const
const TRACE_GRAY = [220, 220, 220, 255] as const
const STRUCTURAL_GRAY = [180, 180, 180, 255] as const
const WHITE = [255, 255, 255, 255] as const

function image(
  width: number,
  height: number,
  rgba: readonly [number, number, number, number] = WHITE,
): RgbaPixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(rgba, pixel * 4)
  }
  return { width, height, data }
}

function paintPixel(
  target: RgbaPixelBuffer,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  ;(target.data as Uint8ClampedArray).set(
    rgba,
    (y * target.width + x) * 4,
  )
}

function paintHorizontal(
  target: RgbaPixelBuffer,
  y: number,
  left: number,
  right: number,
): void {
  for (let x = left; x <= right; x += 1) {
    paintPixel(target, x, y, BLACK)
  }
}

function paintVertical(
  target: RgbaPixelBuffer,
  x: number,
  top: number,
  bottom: number,
): void {
  for (let y = top; y <= bottom; y += 1) {
    paintPixel(target, x, y, BLACK)
  }
}

function paintRectangle(
  target: RgbaPixelBuffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
): void {
  paintHorizontal(target, top, left, right)
  paintHorizontal(target, bottom, left, right)
  paintVertical(target, left, top, bottom)
  paintVertical(target, right, top, bottom)
}

function horizontalDoor(x: number, y: number): PixelDoorSegment {
  return { ax: x - 1, ay: y, bx: x + 1, by: y }
}

function pixelAt(
  result: ReturnType<typeof classifyMainHallways>,
  x: number,
  y: number,
): number {
  return result.pixels[y * result.width + x] ?? -1
}

function testOptions(
  doorSegments: readonly PixelDoorSegment[],
  overrides: Partial<OccupancyClassificationOptions> = {},
): OccupancyClassificationOptions {
  return {
    resolution: 0.1,
    doorSegments,
    minDoorIncidence: 3,
    relativeDoorIncidence: 0.35,
    minComponentAreaMetresSquared: 0.1,
    maxBoundingBoxFillRatio: 1,
    minLongSideMetres: 2,
    ...overrides,
  }
}

function basicHallwayPlan(): {
  source: RgbaPixelBuffer
  doors: PixelDoorSegment[]
} {
  const source = image(50, 36)
  paintRectangle(source, 4, 4, 45, 31)
  paintHorizontal(source, 15, 4, 45)
  paintHorizontal(source, 22, 4, 45)
  for (const x of [14, 24, 34]) {
    paintVertical(source, x, 4, 15)
    paintVertical(source, x, 22, 31)
  }
  // This dark fixture belongs to a room and must not survive as an obstacle.
  paintVertical(source, 9, 8, 10)
  return {
    source,
    doors: [9, 19, 29, 39].map((x) => horizontalDoor(x, 15)),
  }
}

describe('main-hallway trinary classification', () => {
  it('keeps the high-door-incidence hallway white and makes rooms and exterior gray', () => {
    const { source, doors } = basicHallwayPlan()
    const result = classifyMainHallways(source, testOptions(doors))

    expect(pixelAt(result, 20, 18)).toBe(OCCUPANCY_PALETTE.free)
    expect(pixelAt(result, 10, 10)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 0, 0)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 20, 15)).toBe(OCCUPANCY_PALETTE.occupied)
    expect(pixelAt(result, 9, 9)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(new Set(result.pixels)).toEqual(
      new Set([
        OCCUPANCY_PALETTE.occupied,
        OCCUPANCY_PALETTE.excluded,
        OCCUPANCY_PALETTE.free,
      ]),
    )
    expect(result.diagnostics).toMatchObject({
      applied: true,
      selectionMode: 'components',
      selectedComponentCount: 1,
      suppliedDoorCount: 4,
      separatingDoorCount: 4,
      maximumDoorIncidence: 4,
    })
  })

  it('absorbs thin gray drafting traces inside a selected hallway only', () => {
    const { source, doors } = basicHallwayPlan()
    for (let y = 18; y <= 19; y += 1) {
      paintPixel(source, 20, y, TRACE_GRAY)
    }
    for (const [x, y] of [
      [27, 17],
      [28, 18],
      [29, 19],
    ] as const) {
      paintPixel(source, x, y, TRACE_GRAY)
    }
    paintPixel(source, 11, 10, TRACE_GRAY)
    paintPixel(source, 22, 18, STRUCTURAL_GRAY)

    const result = classifyMainHallways(source, testOptions(doors))

    for (let y = 18; y <= 19; y += 1) {
      expect(pixelAt(result, 20, y)).toBe(OCCUPANCY_PALETTE.free)
    }
    for (const [x, y] of [
      [27, 17],
      [28, 18],
      [29, 19],
    ] as const) {
      expect(pixelAt(result, x, y)).toBe(OCCUPANCY_PALETTE.free)
    }
    expect(pixelAt(result, 11, 10)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 22, 18)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(result.diagnostics.removedTracePixelCount).toBe(5)
  })

  it('does not absorb a pale stripe wider than the configured trace limit', () => {
    const { source, doors } = basicHallwayPlan()
    for (let y = 17; y <= 19; y += 1) {
      for (let x = 18; x <= 20; x += 1) {
        paintPixel(source, x, y, TRACE_GRAY)
      }
    }

    const result = classifyMainHallways(
      source,
      testOptions(doors, { softTraceMaxWidthMetres: 0.1 }),
    )

    for (let y = 17; y <= 19; y += 1) {
      for (let x = 18; x <= 20; x += 1) {
        expect(pixelAt(result, x, y)).toBe(OCCUPANCY_PALETTE.excluded)
      }
    }
    expect(result.diagnostics.removedTracePixelCount).toBe(0)
  })

  it('does not mistake a larger enclosed courtyard for the main hallway', () => {
    const source = image(80, 50)
    paintRectangle(source, 3, 3, 27, 46)
    paintRectangle(source, 31, 3, 76, 46)
    paintHorizontal(source, 19, 31, 76)
    paintHorizontal(source, 27, 31, 76)
    for (const x of [41, 51, 61, 71]) {
      paintVertical(source, x, 3, 19)
    }
    const doors = [36, 46, 56, 66].map((x) => horizontalDoor(x, 19))

    const result = classifyMainHallways(source, testOptions(doors))

    // The courtyard is much larger, but has no separating room doors.
    expect(pixelAt(result, 15, 25)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 50, 23)).toBe(OCCUPANCY_PALETTE.free)
    expect(pixelAt(result, 0, 25)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(result.diagnostics.maximumDoorIncidence).toBe(4)
  })

  it('retains multiple high-incidence hallway sections split by a closed cross-door', () => {
    const source = image(90, 45)
    paintRectangle(source, 3, 3, 86, 41)
    paintHorizontal(source, 19, 3, 86)
    paintHorizontal(source, 29, 3, 86)
    paintVertical(source, 45, 19, 29)
    for (const x of [13, 23, 33, 53, 63, 73]) {
      paintVertical(source, x, 3, 19)
    }
    const doors = [8, 18, 28, 38, 50, 60, 70].map((x) =>
      horizontalDoor(x, 19),
    )

    const result = classifyMainHallways(source, testOptions(doors))

    expect(pixelAt(result, 25, 24)).toBe(OCCUPANCY_PALETTE.free)
    expect(pixelAt(result, 65, 24)).toBe(OCCUPANCY_PALETTE.free)
    expect(pixelAt(result, 20, 10)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(result.diagnostics.selectionMode).toBe('components')
    expect(result.diagnostics.selectedComponentCount).toBe(2)
  })

  it('fails closed when the dominant hallway candidate reaches the crop edge', () => {
    const source = image(80, 45)
    paintHorizontal(source, 5, 8, 72)
    paintHorizontal(source, 39, 8, 72)
    paintVertical(source, 72, 5, 39)
    paintVertical(source, 8, 5, 16)
    paintVertical(source, 8, 30, 39)
    paintHorizontal(source, 18, 8, 72)
    paintHorizontal(source, 29, 8, 72)
    for (const x of [18, 30, 42, 54, 66]) {
      paintVertical(source, x, 5, 18)
    }
    const doors = [13, 24, 36, 48, 60].map((x) => horizontalDoor(x, 18))

    const result = classifyMainHallways(source, testOptions(doors))

    expect(result.diagnostics.dominantComponentTouchedEdge).toBe(true)
    expect(result.diagnostics.selectionMode).toBe('none')
    expect(result.diagnostics.applied).toBe(false)
    expect(pixelAt(result, 24, 22)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 0, 22)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 9, 24)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(new Set(result.pixels)).toEqual(
      new Set([OCCUPANCY_PALETTE.excluded]),
    )
    expect(result.diagnostics.reason).toMatch(/crop edge/)
  })

  it('does not emit black obstacles or free space without a hallway candidate', () => {
    const source = image(14, 10)
    paintVertical(source, 7, 2, 7)

    const result = classifyMainHallways(source, testOptions([]))

    expect(new Set(result.pixels)).toEqual(
      new Set([OCCUPANCY_PALETTE.excluded]),
    )
    expect(result.diagnostics).toMatchObject({
      applied: false,
      selectionMode: 'none',
      occupiedPixelCount: 0,
      freePixelCount: 0,
    })
    expect(result.diagnostics.reason).toMatch(/area, shape, and closed-door/)
  })

  it('selects only a three-metre courtyard annulus and keeps the courtyard excluded', () => {
    const source = image(40, 40)
    paintRectangle(source, 8, 8, 31, 31)
    // A separate enclosed, elongated corridor also sits inside the annulus.
    paintRectangle(source, 32, 12, 34, 27)

    const result = classifyMainHallways(source, {
      resolution: 1,
      doorSegments: [],
      sealRadiusMetres: 0,
    })

    expect(result.diagnostics.courtyardDetected).toBe(true)
    expect(result.diagnostics.selectionMode).toBe('courtyard-annulus')
    expect(result.diagnostics.courtyardImageFraction).toBeGreaterThan(0.25)
    expect(result.diagnostics.courtyardBoundingBoxFillRatio).toBe(1)
    expect(result.diagnostics.courtyardAnnulusPixelCount).toBeGreaterThan(0)
    expect(pixelAt(result, 20, 20)).toBe(OCCUPANCY_PALETTE.excluded)
    expect(pixelAt(result, 7, 20)).toBe(OCCUPANCY_PALETTE.free)
    expect(pixelAt(result, 33, 20)).toBe(OCCUPANCY_PALETTE.free)
    expect(pixelAt(result, 8, 20)).toBe(OCCUPANCY_PALETTE.occupied)
    expect(pixelAt(result, 0, 0)).toBe(OCCUPANCY_PALETTE.excluded)
  })

  it('does not trigger courtyard mode for a large room with doors or tied large voids', () => {
    const roomSource = image(40, 40)
    paintRectangle(roomSource, 8, 8, 31, 31)
    const roomResult = classifyMainHallways(roomSource, {
      resolution: 1,
      doorSegments: [horizontalDoor(15, 8), horizontalDoor(24, 8)],
      sealRadiusMetres: 0,
    })

    expect(roomResult.diagnostics.courtyardDetected).toBe(false)
    expect(roomResult.diagnostics.selectionMode).toBe('none')
    expect(new Set(roomResult.pixels)).toEqual(
      new Set([OCCUPANCY_PALETTE.excluded]),
    )

    const tiedSource = image(60, 35)
    paintRectangle(tiedSource, 2, 2, 29, 32)
    paintRectangle(tiedSource, 31, 2, 58, 32)
    const tiedResult = classifyMainHallways(tiedSource, {
      resolution: 1,
      doorSegments: [],
      sealRadiusMetres: 0,
    })

    expect(tiedResult.diagnostics.courtyardDetected).toBe(false)
    expect(tiedResult.diagnostics.selectionMode).toBe('none')
  })
})

describe('occupancy input validation', () => {
  it('rejects invalid image buffers and resolutions', () => {
    expect(() =>
      classifyMainHallways(
        { width: 0, height: 2, data: new Uint8Array() },
        testOptions([]),
      ),
    ).toThrow(/image.width/)
    expect(() =>
      classifyMainHallways(
        { width: 2, height: 2, data: new Uint8Array(15) },
        testOptions([]),
      ),
    ).toThrow(/four RGBA channels/)
    expect(() =>
      classifyMainHallways(image(2, 2), {
        resolution: 0,
        doorSegments: [],
      }),
    ).toThrow(/resolution/)
  })

  it('rejects invalid thresholds and door geometry', () => {
    expect(() =>
      classifyMainHallways(image(4, 4), {
        resolution: 0.1,
        doorSegments: [],
        strongDarkLuminanceMax: 96,
        nearWhiteLuminanceMin: 97,
      }),
    ).not.toThrow()
    expect(() =>
      classifyMainHallways(image(4, 4), {
        resolution: 0.1,
        doorSegments: [],
        strongDarkLuminanceMax: 230,
        nearWhiteLuminanceMin: 220,
      }),
    ).toThrow(/Luminance thresholds/)
    expect(() =>
      classifyMainHallways(image(4, 4), {
        resolution: 0.1,
        doorSegments: [{ ax: 1, ay: 1, bx: 1, by: 1 }],
      }),
    ).toThrow(/visible length/)
    expect(() =>
      classifyMainHallways(image(4, 4), {
        resolution: 0.1,
        doorSegments: [],
        softTraceMaxWidthMetres: -0.1,
      }),
    ).toThrow(/softTraceMaxWidthMetres/)
    expect(() =>
      classifyMainHallways(image(4, 4), {
        resolution: 0.1,
        doorSegments: [],
        softTraceLuminanceMin: 90,
      }),
    ).toThrow(/softTraceLuminanceMin/)
  })
})
