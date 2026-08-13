/** Printed drawing scales present in the verified SFU key-plan corpus. */
export const SUPPORTED_SCALE_DENOMINATORS = [
  50,
  75,
  100,
  125,
  150,
  175,
  200,
  250,
  300,
  400,
] as const

export type SupportedScaleDenominator =
  (typeof SUPPORTED_SCALE_DENOMINATORS)[number]

export type ScaleDetectionResult =
  | {
      status: 'detected'
      denominator: SupportedScaleDenominator
      candidates: readonly [SupportedScaleDenominator]
    }
  | {
      status: 'missing'
      candidates: readonly []
    }
  | {
      status: 'ambiguous'
      candidates: readonly number[]
    }
  | {
      status: 'unsupported'
      candidates: readonly [number]
    }

// Accept the normal colon and Unicode ratio colon. The surrounding guards keep
// decimal values, larger numerators, identifiers, and reversed ratios from
// being mistaken for a printed drawing scale.
const SCALE_PATTERN =
  /(?<![\p{L}\p{N}_.])1\s*[:\u2236]\s*([1-9]\d*)(?![\p{L}\p{N}_.])/gu

export function isSupportedScaleDenominator(
  denominator: number,
): denominator is SupportedScaleDenominator {
  return SUPPORTED_SCALE_DENOMINATORS.some(
    (supported) => denominator === supported,
  )
}

/**
 * Extracts unique `1:n` denominators from PDF text or any other text fragments.
 * Joining the fragments first also handles a PDF text run split around `1 : n`.
 */
export function extractScaleDenominators(
  textFragments: Iterable<string>,
): number[] {
  const text = Array.from(textFragments).join(' ')
  const denominators: number[] = []

  for (const match of text.matchAll(SCALE_PATTERN)) {
    const denominator = Number(match[1])
    if (
      Number.isSafeInteger(denominator) &&
      !denominators.includes(denominator)
    ) {
      denominators.push(denominator)
    }
  }

  return denominators
}

/** Detects one supported scale, while refusing ambiguous or unsupported input. */
export function detectScale(
  textFragments: Iterable<string>,
): ScaleDetectionResult {
  const candidates = extractScaleDenominators(textFragments)

  if (candidates.length === 0) {
    return { status: 'missing', candidates: [] }
  }

  if (candidates.length > 1) {
    return { status: 'ambiguous', candidates }
  }

  const denominator = candidates[0]
  if (isSupportedScaleDenominator(denominator)) {
    return {
      status: 'detected',
      denominator,
      candidates: [denominator],
    }
  }

  return { status: 'unsupported', candidates: [denominator] }
}

/** Converts a printed scale and requested ROS resolution into render DPI. */
export function calculateRenderDpi(
  scaleDenominator: number,
  metresPerPixel: number,
): number {
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) {
    throw new RangeError('Scale denominator must be a positive finite number.')
  }
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) {
    throw new RangeError('Metres per pixel must be a positive finite number.')
  }

  return (scaleDenominator / metresPerPixel) * 0.0254
}
