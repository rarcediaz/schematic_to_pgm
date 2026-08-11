export const SFU_LAYER_PROFILE_VERSION = 'sfu-v1' as const

export type SfuLayerRole =
  | 'grid'
  | 'room-text'
  | 'title'
  | 'north-indicator'
  | 'sheet-border'
  | 'wall'
  | 'door'
  | 'stair'
  | 'unknown'

export type SfuLayerAction = 'remove' | 'replace' | 'keep' | 'review'

export interface SfuLayerClassification {
  readonly profileVersion: typeof SFU_LAYER_PROFILE_VERSION
  readonly originalName: string
  readonly suffix: string
  readonly role: SfuLayerRole
  /** `replace` content is hidden only after its semantic replacement is ready. */
  readonly action: SfuLayerAction
  readonly visible: boolean
  readonly known: boolean
}

export interface SfuLayerClassificationOptions {
  /** Destructive profile rules are disabled unless recognition is explicit. */
  readonly profileRecognized?: boolean
}

interface SfuLayerRule {
  readonly role: Exclude<SfuLayerRole, 'sheet-border' | 'unknown'>
  readonly action: SfuLayerAction
}

const SUFFIX_RULES = Object.freeze({
  SGR: { role: 'grid', action: 'remove' },
  SGRID: { role: 'grid', action: 'remove' },
  SGRDI: { role: 'grid', action: 'remove' },
  'RM$TXT': { role: 'room-text', action: 'remove' },
  ASHTT: { role: 'title', action: 'remove' },
  'BBY-SFU-NORTH': { role: 'north-indicator', action: 'remove' },
  AWA: { role: 'wall', action: 'keep' },
  ADO: { role: 'door', action: 'replace' },
  AFLST: { role: 'stair', action: 'review' },
} satisfies Readonly<Record<string, SfuLayerRule>>)

export const SFU_LAYER_PROFILE_V1 = Object.freeze({
  version: SFU_LAYER_PROFILE_VERSION,
  suffixRules: SUFFIX_RULES,
})

/** Normalizes the semantic AutoCAD layer name after the final `|`. */
export function normalizeLayerSuffix(layerName: string): string {
  const normalized = layerName.normalize('NFKC')
  const separatorIndex = normalized.lastIndexOf('|')
  return normalized.slice(separatorIndex + 1).trim().toUpperCase()
}

function retain(
  originalName: string,
  suffix: string,
  role: SfuLayerRole,
  action: 'keep' | 'review',
  known: boolean,
): SfuLayerClassification {
  return {
    profileVersion: SFU_LAYER_PROFILE_VERSION,
    originalName,
    suffix,
    role,
    action,
    visible: true,
    known,
  }
}

/**
 * Classifies an optional-content layer and computes its conservative visibility.
 * Unknown and stair layers are never hidden by this profile. Door layers are
 * marked for replacement, but the renderer keeps them until closures exist.
 */
export function classifySfuLayer(
  layerName: string,
  options: SfuLayerClassificationOptions = {},
): SfuLayerClassification {
  const suffix = normalizeLayerSuffix(layerName)
  const normalizedFullName = layerName.normalize('NFKC').trim().toUpperCase()
  const profileRecognized = options.profileRecognized === true

  if (normalizedFullName === '0') {
    if (!profileRecognized) {
      return retain(layerName, suffix, 'sheet-border', 'keep', true)
    }
    return {
      profileVersion: SFU_LAYER_PROFILE_VERSION,
      originalName: layerName,
      suffix,
      role: 'sheet-border',
      action: 'remove',
      visible: false,
      known: true,
    }
  }

  const rule = SUFFIX_RULES[suffix as keyof typeof SUFFIX_RULES]
  if (!rule) {
    return retain(layerName, suffix, 'unknown', 'keep', false)
  }

  if (!profileRecognized || rule.action === 'keep') {
    return retain(layerName, suffix, rule.role, 'keep', true)
  }

  if (rule.action === 'review') {
    return retain(layerName, suffix, rule.role, 'review', true)
  }

  return {
    profileVersion: SFU_LAYER_PROFILE_VERSION,
    originalName: layerName,
    suffix,
    role: rule.role,
    action: rule.action,
    visible: false,
    known: true,
  }
}
