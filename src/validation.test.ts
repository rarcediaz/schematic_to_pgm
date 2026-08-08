import { describe, expect, it } from 'vitest'

import {
  ValidationError,
  sanitizeBaseFilename,
  validateMapSettings,
  validateResolution,
} from './validation'

describe('filename sanitization', () => {
  it('strips recognized suffixes and disallowed characters', () => {
    expect(sanitizeBaseFilename('  SFU Level 9000.PDF  ')).toBe('SFULevel9000')
    expect(sanitizeBaseFilename('map.pgm.yaml')).toBe('map')
    expect(sanitizeBaseFilename('floor_A-2')).toBe('floor_A-2')
  })
})

describe('map setting validation', () => {
  it.each(['', '0', '-0.1', 'not-a-number'])('rejects resolution %j', (value) => {
    expect(() => validateResolution(value)).toThrow(ValidationError)
  })

  it('returns normalized values', () => {
    expect(
      validateMapSettings({
        baseFilename: 'level 9.pdf',
        resolution: '0.05',
        originX: '-1.25',
        originY: '2',
      }),
    ).toEqual({
      baseFilename: 'level9',
      resolution: 0.05,
      originX: -1.25,
      originY: 2,
    })
  })
})
