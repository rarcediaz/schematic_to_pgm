import { describe, expect, it } from 'vitest'

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
})
