import { describe, expect, it } from 'vitest'

import {
  createPgmHeader,
  grayscaleByte,
  imageDataToPgmBytes,
} from './pgm'

describe('PGM conversion', () => {
  it('creates the exact P5 header', () => {
    expect(createPgmHeader(640, 480)).toBe('P5\n640 480\n255\n')
  })

  it('uses the required grayscale coefficients and rounding', () => {
    expect(grayscaleByte(255, 0, 0)).toBe(76)
    expect(grayscaleByte(0, 255, 0)).toBe(150)
    expect(grayscaleByte(0, 0, 255)).toBe(29)
  })

  it('composites transparent pixels over white', () => {
    expect(grayscaleByte(0, 0, 0, 0)).toBe(255)
    expect(grayscaleByte(0, 0, 0, 128)).toBe(127)
  })

  it('appends exactly one byte per pixel after the header', () => {
    const bytes = imageDataToPgmBytes({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
    })
    const header = new TextEncoder().encode('P5\n2 1\n255\n')
    expect([...bytes.slice(0, header.length)]).toEqual([...header])
    expect([...bytes.slice(header.length)]).toEqual([255, 0])
  })
})
