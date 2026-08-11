import { describe, expect, it } from 'vitest'

import { MAP_DEFAULTS, OCCUPANCY_PALETTE } from './constants'
import { createMapYaml } from './yaml'

describe('createMapYaml', () => {
  it('uses the original ROS map defaults', () => {
    expect(createMapYaml()).toBe(
      'image: map.pgm\n' +
        'mode: trinary\n' +
        'resolution: 0.05\n' +
        'origin: [0.0, 0.0, 0.0]\n' +
        'negate: 0\n' +
        'occupied_thresh: 0.65\n' +
        'free_thresh: 0.25\n',
    )
  })

  it('sanitizes the shared filename and writes user map values', () => {
    expect(
      createMapYaml({
        baseFilename: 'SFU 9000.pdf',
        resolution: '0.025',
        originX: '-2',
        originY: 3.5,
      }),
    ).toContain('image: SFU9000.pgm\n')
    expect(createMapYaml({ originX: -2, originY: 3.5 })).toContain(
      'origin: [-2.0, 3.5, 0.0]\n',
    )
  })

  it('keeps gray excluded space occupied with the emitted thresholds', () => {
    const occupancy = (gray: number) =>
      MAP_DEFAULTS.negate === 0 ? (255 - gray) / 255 : gray / 255

    expect(occupancy(OCCUPANCY_PALETTE.occupied)).toBeGreaterThan(
      MAP_DEFAULTS.occupiedThreshold,
    )
    expect(occupancy(OCCUPANCY_PALETTE.free)).toBeLessThan(
      MAP_DEFAULTS.freeThreshold,
    )
    expect(occupancy(OCCUPANCY_PALETTE.excluded)).toBeGreaterThan(
      MAP_DEFAULTS.occupiedThreshold,
    )
  })
})
