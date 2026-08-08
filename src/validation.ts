import { MAX_PDF_BYTES } from './constants'

export type ValidationField =
  | 'file'
  | 'baseFilename'
  | 'resolution'
  | 'originX'
  | 'originY'

export class ValidationError extends Error {
  readonly field: ValidationField

  constructor(field: ValidationField, message: string) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
  }
}

export interface MapFormValues {
  baseFilename: string
  resolution: string | number
  originX: string | number
  originY: string | number
}

export interface ValidatedMapSettings {
  baseFilename: string
  resolution: number
  originX: number
  originY: number
}

const REMOVABLE_EXTENSION = /\.(?:pdf|pgm|ya?ml|png|jpe?g)$/i

/** Produces the safe shared stem used by both generated downloads. */
export function sanitizeBaseFilename(input: string): string {
  let stem = input.trim()

  // Handle pasted names such as map.pdf.yaml as well as a normal single suffix.
  while (REMOVABLE_EXTENSION.test(stem)) {
    stem = stem.replace(REMOVABLE_EXTENSION, '').trim()
  }

  return stem.replace(/[^A-Za-z0-9_-]/g, '')
}

export function validateBaseFilename(input: string): string {
  if (input.trim() === '') {
    throw new ValidationError('baseFilename', 'Enter a base filename.')
  }

  const sanitized = sanitizeBaseFilename(input)
  if (sanitized === '') {
    throw new ValidationError(
      'baseFilename',
      'The filename must contain a letter, number, underscore, or hyphen.',
    )
  }
  return sanitized
}

function parseFiniteNumber(
  value: string | number,
  field: 'resolution' | 'originX' | 'originY',
  label: string,
): number {
  if (typeof value === 'string' && value.trim() === '') {
    throw new ValidationError(field, `Enter ${label}.`)
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(field, `${label} must be a valid number.`)
  }
  return parsed
}

export function validateResolution(value: string | number): number {
  const resolution = parseFiniteNumber(value, 'resolution', 'a resolution')
  if (resolution <= 0) {
    throw new ValidationError('resolution', 'Resolution must be greater than zero.')
  }
  return resolution
}

export function validateOrigin(
  value: string | number,
  axis: 'X' | 'Y',
): number {
  const field = axis === 'X' ? 'originX' : 'originY'
  return parseFiniteNumber(value, field, `an origin ${axis} value`)
}

/** Validates and normalizes all editable values required to generate a map. */
export function validateMapSettings(values: MapFormValues): ValidatedMapSettings {
  return {
    baseFilename: validateBaseFilename(values.baseFilename),
    resolution: validateResolution(values.resolution),
    originX: validateOrigin(values.originX, 'X'),
    originY: validateOrigin(values.originY, 'Y'),
  }
}

export type PdfValidationCode =
  | 'NO_FILE'
  | 'INVALID_EXTENSION'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_SIGNATURE'

export class PdfValidationError extends ValidationError {
  readonly code: PdfValidationCode

  constructor(code: PdfValidationCode, message: string) {
    super('file', message)
    this.name = 'PdfValidationError'
    this.code = code
  }
}

/** Checks cheap metadata constraints before the browser reads the PDF. */
export function validatePdfMetadata(file: File | null | undefined): asserts file is File {
  if (!file) {
    throw new PdfValidationError('NO_FILE', 'Choose a PDF file first.')
  }
  if (!/\.pdf$/i.test(file.name)) {
    throw new PdfValidationError(
      'INVALID_EXTENSION',
      'Choose a file with the .pdf extension.',
    )
  }
  if (file.size === 0) {
    throw new PdfValidationError('EMPTY_FILE', 'The selected PDF is empty.')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfValidationError(
      'FILE_TOO_LARGE',
      'The selected PDF is larger than the 20 MiB limit.',
    )
  }
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const // %PDF-

function containsPdfSignature(bytes: Uint8Array): boolean {
  const lastStart = bytes.length - PDF_SIGNATURE.length
  for (let offset = 0; offset <= lastStart; offset += 1) {
    if (PDF_SIGNATURE.every((byte, index) => bytes[offset + index] === byte)) {
      return true
    }
  }
  return false
}

/** Verifies extension, size, and the PDF header (which may occur within byte 1024). */
export async function validatePdfFile(
  file: File | null | undefined,
): Promise<void> {
  validatePdfMetadata(file)
  const prefix = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  if (!containsPdfSignature(prefix)) {
    throw new PdfValidationError(
      'INVALID_SIGNATURE',
      'The selected file does not have a valid PDF signature.',
    )
  }
}
