import { describe, expect, it } from 'vitest'

import {
  calculateRenderDpi,
  detectScale,
  extractScaleDenominators,
} from './scale'

describe('scale detection', () => {
  it('detects supported scales across generic text fragments', () => {
    expect(detectScale(['SCALE', '1', ':', '250', 'LEVEL 9000'])).toEqual({
      status: 'detected',
      denominator: 250,
      candidates: [250],
    })
    expect(detectScale(['Scale 1\u2236400'])).toEqual({
      status: 'detected',
      denominator: 400,
      candidates: [400],
    })
  })

  it('deduplicates repeated occurrences of the same scale', () => {
    expect(detectScale(['1:250', 'PRINTED SCALE 1 : 250'])).toMatchObject({
      status: 'detected',
      denominator: 250,
      candidates: [250],
    })
  })

  it('reports missing, ambiguous, and unsupported scales separately', () => {
    expect(detectScale(['No printed scale', '250:1'])).toEqual({
      status: 'missing',
      candidates: [],
    })
    expect(detectScale(['Overview 1:400', 'Detail 1:250'])).toEqual({
      status: 'ambiguous',
      candidates: [400, 250],
    })
    expect(detectScale(['Scale 1:500'])).toEqual({
      status: 'unsupported',
      candidates: [500],
    })
  })

  it('only accepts a strict 1-to-positive-integer ratio', () => {
    expect(
      extractScaleDenominators([
        '11:250',
        '01:250',
        '1.1:250',
        '1:0250',
        '1:250.5',
        'A1:250',
      ]),
    ).toEqual([])
  })
})

describe('render DPI calculation', () => {
  it('uses the drawing-scale calibration formula without rounding', () => {
    expect(calculateRenderDpi(250, 0.05)).toBe(127)
    expect(calculateRenderDpi(400, 0.05)).toBe(203.2)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid scale denominator %s',
    (denominator) => {
      expect(() => calculateRenderDpi(denominator, 0.05)).toThrow(RangeError)
    },
  )

  it.each([0, -0.05, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid resolution %s',
    (resolution) => {
      expect(() => calculateRenderDpi(250, resolution)).toThrow(RangeError)
    },
  )
})
