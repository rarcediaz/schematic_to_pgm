import { describe, expect, it } from 'vitest'

import { OCCUPANCY_PALETTE } from './constants'
import { composeOccupancyPreview } from './occupancy-preview'

describe('occupancy preview composition', () => {
  it('keeps free and occupied exact while retaining excluded source detail', () => {
    const source = new Uint8ClampedArray([
      100, 120, 140, 255,
      20, 20, 20, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ])
    const mask = new Uint8Array([
      OCCUPANCY_PALETTE.free,
      OCCUPANCY_PALETTE.occupied,
      OCCUPANCY_PALETTE.excluded,
      OCCUPANCY_PALETTE.excluded,
      OCCUPANCY_PALETTE.excluded,
    ])
    const roomMask = new Uint8Array([0, 0, 1, 1, 0])
    const sourceBefore = source.slice()
    const maskBefore = mask.slice()

    const preview = composeOccupancyPreview(
      { width: 5, height: 1, data: source },
      { width: 5, height: 1, pixels: mask, roomMask },
    )

    expect([...preview.slice(0, 4)]).toEqual([255, 255, 255, 255])
    expect([...preview.slice(4, 8)]).toEqual([0, 0, 0, 255])
    expect(preview[8]).toBe(176)
    expect(preview[12]).toBe(232)
    expect(preview[16]).toBe(112)
    expect(source).toEqual(sourceBefore)
    expect(mask).toEqual(maskBefore)
  })

  it('rejects mismatched dimensions and non-trinary mask values', () => {
    expect(() =>
      composeOccupancyPreview(
        { width: 1, height: 1, data: new Uint8ClampedArray(4) },
        {
          width: 2,
          height: 1,
          pixels: new Uint8Array(2),
          roomMask: new Uint8Array(2),
        },
      ),
    ).toThrow(/dimensions must match/i)

    expect(() =>
      composeOccupancyPreview(
        { width: 1, height: 1, data: new Uint8ClampedArray(4) },
        {
          width: 1,
          height: 1,
          pixels: new Uint8Array([205]),
          roomMask: new Uint8Array(1),
        },
      ),
    ).toThrow(/unsupported occupancy/i)
  })
})
