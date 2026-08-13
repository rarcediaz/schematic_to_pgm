import { describe, expect, it } from 'vitest'

import {
  SFU_LAYER_PROFILE_V1,
  classifySfuLayer,
  isRecognizedSfuSheet,
  normalizeLayerSuffix,
} from './sfu-profile'

describe('SFU layer-name normalization', () => {
  it('uses the normalized suffix after the final separator', () => {
    expect(normalizeLayerSuffix('038|LEVEL 9000| awa ')).toBe('AWA')
    expect(normalizeLayerSuffix('PREFIX|SUBGROUP|rm＄txt')).toBe('RM$TXT')
    expect(normalizeLayerSuffix('  BBY-SFU-NORTH  ')).toBe('BBY-SFU-NORTH')
  })
})

describe('SFU sheet recognition', () => {
  const sheet = { rotation: 270, view: [0, 0, 1260, 2088] }

  it.each([
    ['standard wall plan', ['0', 'ASHTT', 'PLAN Data|RM$TXT', 'PLAN|AWA']],
    ['alternate wall plan', ['0', 'ASHTT', 'PLAN Data|RM$TXT', 'PLAN|LWA']],
    ['sparse glazing plan', ['0', 'ASHTT', 'PLAN Data|RM$TXT', 'PLAN|AGL']],
  ])('recognizes a %s without optional grid or north layers', (_label, layers) => {
    expect(isRecognizedSfuSheet(sheet, layers)).toBe(true)
  })

  it('rejects lookalikes without template anchors or physical plan geometry', () => {
    expect(isRecognizedSfuSheet(sheet, ['0', 'ASHTT', 'PLAN|AWA'])).toBe(false)
    expect(
      isRecognizedSfuSheet(sheet, ['0', 'ASHTT', 'PLAN Data|RM$TXT', 'PLAN|SGR']),
    ).toBe(false)
    expect(
      isRecognizedSfuSheet(
        { rotation: 0, view: sheet.view },
        ['0', 'ASHTT', 'PLAN Data|RM$TXT', 'PLAN|AWA'],
      ),
    ).toBe(false)
  })
})

describe('SFU v1 layer profile', () => {
  it('is explicitly versioned', () => {
    expect(SFU_LAYER_PROFILE_V1.version).toBe('sfu-v1')
  })

  it.each([
    ['SGR', 'grid'],
    ['BLDG|SGRID', 'grid'],
    ['BLDG|FLOOR|SGRDI', 'grid'],
    ['RM$TXT', 'room-text'],
    ['ASHTT', 'title'],
    ['BBY-SFU-NORTH', 'north-indicator'],
  ] as const)('removes recognized %s content', (name, role) => {
    expect(classifySfuLayer(name, { profileRecognized: true })).toMatchObject({
      role,
      action: 'remove',
      visible: false,
      known: true,
    })
  })

  it('does not apply destructive rules before profile recognition', () => {
    expect(classifySfuLayer('BUILDING|SGRID')).toMatchObject({
      role: 'grid',
      action: 'keep',
      visible: true,
      known: true,
    })
  })

  it('only removes layer 0 when it is the complete layer name', () => {
    expect(classifySfuLayer(' 0 ', { profileRecognized: true })).toMatchObject({
      role: 'sheet-border',
      action: 'remove',
      visible: false,
    })
    expect(
      classifySfuLayer('BUILDING|0', { profileRecognized: true }),
    ).toMatchObject({
      role: 'unknown',
      action: 'keep',
      visible: true,
      known: false,
    })
  })

  it('keeps walls and stairs while marking doors for semantic replacement', () => {
    expect(
      classifySfuLayer('BUILDING|AWA', { profileRecognized: true }),
    ).toMatchObject({ role: 'wall', action: 'keep', visible: true })
    expect(
      classifySfuLayer('BUILDING|ADO', { profileRecognized: true }),
    ).toMatchObject({ role: 'door', action: 'replace', visible: false })
    expect(
      classifySfuLayer('BUILDING|AFLST', { profileRecognized: true }),
    ).toMatchObject({ role: 'stair', action: 'review', visible: true })
  })

  it('keeps the exact GROS building-envelope layer as known content', () => {
    expect(
      classifySfuLayer('FP002_3 Data|GROS', { profileRecognized: true }),
    ).toMatchObject({
      suffix: 'GROS',
      role: 'building-envelope',
      action: 'keep',
      visible: true,
      known: true,
    })
    expect(
      classifySfuLayer('FP002_3 Data|GROSS', { profileRecognized: true }),
    ).toMatchObject({ role: 'unknown', known: false })
  })

  it('preserves unknown layers at their default visibility', () => {
    expect(
      classifySfuLayer('BUILDING|FUTURE-LAYER', { profileRecognized: true }),
    ).toEqual({
      profileVersion: 'sfu-v1',
      originalName: 'BUILDING|FUTURE-LAYER',
      suffix: 'FUTURE-LAYER',
      role: 'unknown',
      action: 'keep',
      visible: true,
      known: false,
    })
  })
})
