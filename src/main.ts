import './style.css'

import { MAP_DEFAULTS, PDF_RENDER_DPI } from './constants'
import { renderSinglePagePdf } from './pdf'
import { canvasToPgmBlob } from './pgm'
import {
  ValidationError,
  validateMapSettings,
  type ValidatedMapSettings,
} from './validation'
import { createMapYamlBlob } from './yaml'

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing required element: #${id}`)
  return element as T
}

const form = getElement<HTMLFormElement>('converter-form')
const pdfInput = getElement<HTMLInputElement>('pdf-input')
const baseFilenameInput = getElement<HTMLInputElement>('base-filename')
const resolutionInput = getElement<HTMLInputElement>('resolution')
const originXInput = getElement<HTMLInputElement>('origin-x')
const originYInput = getElement<HTMLInputElement>('origin-y')
const generateButton = getElement<HTMLButtonElement>('generate-button')
const downloadPgm = getElement<HTMLAnchorElement>('download-pgm')
const downloadYaml = getElement<HTMLAnchorElement>('download-yaml')
const statusMessage = getElement<HTMLParagraphElement>('status-message')
const fileDetails = getElement<HTMLParagraphElement>('file-details')
const previewPlaceholder = getElement<HTMLDivElement>('preview-placeholder')
let previewCanvas = getElement<HTMLCanvasElement>('preview-canvas')
const outputDetails = getElement<HTMLDivElement>('output-details')
const outputDetailsText = (() => {
  const element = outputDetails.querySelector<HTMLParagraphElement>('p')
  if (!element) throw new Error('Missing output details text.')
  return element
})()

let pdfReady = false
let selectionToken = 0
let pgmUrl: string | null = null
let yamlUrl: string | null = null
let hasGeneratedFiles = false

function setStatus(
  message: string,
  state: 'neutral' | 'success' | 'error' = 'neutral',
): void {
  statusMessage.textContent = message
  statusMessage.dataset.state = state
  statusMessage.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite')
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function revokeDownloadUrls(): void {
  if (pgmUrl) URL.revokeObjectURL(pgmUrl)
  if (yamlUrl) URL.revokeObjectURL(yamlUrl)
  pgmUrl = null
  yamlUrl = null
}

function setDownloadEnabled(
  link: HTMLAnchorElement,
  enabled: boolean,
  url?: string,
  filename?: string,
): void {
  link.classList.toggle('is-disabled', !enabled)
  link.setAttribute('aria-disabled', String(!enabled))
  link.tabIndex = enabled ? 0 : -1

  if (enabled && url && filename) {
    link.href = url
    link.download = filename
  } else {
    link.removeAttribute('href')
    link.removeAttribute('download')
  }
}

function clearGeneratedFiles(announce = false): void {
  const hadFiles = hasGeneratedFiles
  revokeDownloadUrls()
  setDownloadEnabled(downloadPgm, false)
  setDownloadEnabled(downloadYaml, false)
  hasGeneratedFiles = false

  if (announce && hadFiles) {
    setStatus('Settings changed. Generate the files again to update them.')
  }
}

function resetPreview(): void {
  previewCanvas.hidden = true
  previewCanvas.width = 0
  previewCanvas.height = 0
  previewPlaceholder.hidden = false
  outputDetailsText.textContent =
    'Dimensions and file information will appear after the PDF loads.'
}

function currentSettings(): ValidatedMapSettings {
  return validateMapSettings({
    baseFilename: baseFilenameInput.value,
    resolution: resolutionInput.value,
    originX: originXInput.value,
    originY: originYInput.value,
  })
}

function updateOutputDetails(): void {
  if (!pdfReady || previewCanvas.width === 0 || previewCanvas.height === 0) return

  const resolution = Number(resolutionInput.value)
  const pixelDescription = `${previewCanvas.width.toLocaleString()} × ${previewCanvas.height.toLocaleString()} px`

  if (!Number.isFinite(resolution) || resolution <= 0) {
    outputDetailsText.textContent = `${pixelDescription} at ${PDF_RENDER_DPI} DPI. Enter a valid resolution to calculate map extent.`
    return
  }

  const widthMetres = previewCanvas.width * resolution
  const heightMetres = previewCanvas.height * resolution
  const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
  outputDetailsText.textContent = `${pixelDescription} at ${PDF_RENDER_DPI} DPI · ${metres.format(widthMetres)} × ${metres.format(heightMetres)} m at the entered resolution.`
}

function focusValidationField(error: ValidationError): void {
  const fields: Record<ValidationError['field'], HTMLElement> = {
    file: pdfInput,
    baseFilename: baseFilenameInput,
    resolution: resolutionInput,
    originX: originXInput,
    originY: originYInput,
  }
  fields[error.field].focus()
}

async function handlePdfSelection(): Promise<void> {
  const token = ++selectionToken
  const file = pdfInput.files?.[0]

  pdfReady = false
  generateButton.disabled = true
  clearGeneratedFiles()
  resetPreview()

  if (!file) {
    fileDetails.textContent = 'No PDF selected'
    setStatus('Select a PDF to begin.')
    return
  }

  pdfInput.disabled = true
  form.setAttribute('aria-busy', 'true')
  fileDetails.textContent = `${file.name} · ${formatFileSize(file.size)}`
  setStatus('Loading and rendering the full PDF sheet…')

  try {
    const rendered = await renderSinglePagePdf(file)
    if (token !== selectionToken) {
      rendered.canvas.width = 0
      rendered.canvas.height = 0
      return
    }

    rendered.canvas.id = 'preview-canvas'
    rendered.canvas.hidden = false
    rendered.canvas.setAttribute(
      'aria-label',
      `Full-sheet grayscale preview of ${file.name}`,
    )
    previewCanvas.replaceWith(rendered.canvas)
    previewCanvas = rendered.canvas
    previewPlaceholder.hidden = true
    pdfReady = true
    generateButton.disabled = false
    fileDetails.textContent = `${file.name} · ${formatFileSize(file.size)} · 1 page`
    updateOutputDetails()
    setStatus('PDF ready. Generate the PGM and YAML files.', 'success')
  } catch (error) {
    if (token !== selectionToken) return
    const message =
      error instanceof Error ? error.message : 'The PDF could not be loaded.'
    fileDetails.textContent = `${file.name} · could not be loaded`
    setStatus(message, 'error')
    pdfInput.focus()
  } finally {
    if (token === selectionToken) {
      pdfInput.disabled = false
      form.removeAttribute('aria-busy')
    }
  }
}

function installDownloads(
  settings: ValidatedMapSettings,
  pgmBlob: Blob,
  yamlBlob: Blob,
): void {
  revokeDownloadUrls()
  pgmUrl = URL.createObjectURL(pgmBlob)
  yamlUrl = URL.createObjectURL(yamlBlob)
  setDownloadEnabled(
    downloadPgm,
    true,
    pgmUrl,
    `${settings.baseFilename}.pgm`,
  )
  setDownloadEnabled(
    downloadYaml,
    true,
    yamlUrl,
    `${settings.baseFilename}.yaml`,
  )
  hasGeneratedFiles = true
}

async function handleGenerate(event: SubmitEvent): Promise<void> {
  event.preventDefault()

  if (!pdfReady || previewCanvas.width === 0 || previewCanvas.height === 0) {
    setStatus('Choose and load a one-page PDF before generating files.', 'error')
    pdfInput.focus()
    return
  }

  clearGeneratedFiles()
  generateButton.disabled = true
  generateButton.textContent = 'Generating…'
  form.setAttribute('aria-busy', 'true')
  setStatus('Converting the rendered PDF to grayscale PGM bytes…')

  try {
    const settings = currentSettings()
    baseFilenameInput.value = settings.baseFilename

    // Let the loading message paint before the synchronous pixel conversion.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const pgmBlob = canvasToPgmBlob(previewCanvas)
    const yamlBlob = createMapYamlBlob(settings)
    installDownloads(settings, pgmBlob, yamlBlob)
    updateOutputDetails()
    setStatus(
      `Generated ${settings.baseFilename}.pgm and ${settings.baseFilename}.yaml.`,
      'success',
    )
  } catch (error) {
    clearGeneratedFiles()
    if (error instanceof ValidationError) {
      setStatus(error.message, 'error')
      focusValidationField(error)
    } else {
      setStatus(
        error instanceof Error
          ? error.message
          : 'The map files could not be generated.',
        'error',
      )
    }
  } finally {
    generateButton.disabled = !pdfReady
    generateButton.textContent = 'Generate map files'
    form.removeAttribute('aria-busy')
  }
}

pdfInput.addEventListener('change', () => {
  void handlePdfSelection()
})

form.addEventListener('submit', (event) => {
  void handleGenerate(event)
})

for (const input of [
  baseFilenameInput,
  resolutionInput,
  originXInput,
  originYInput,
]) {
  input.addEventListener('input', () => {
    clearGeneratedFiles(true)
    updateOutputDetails()
  })
}

window.addEventListener('beforeunload', revokeDownloadUrls)

baseFilenameInput.value = MAP_DEFAULTS.baseFilename
resolutionInput.value = String(MAP_DEFAULTS.resolution)
originXInput.value = MAP_DEFAULTS.originX.toFixed(1)
originYInput.value = MAP_DEFAULTS.originY.toFixed(1)
setDownloadEnabled(downloadPgm, false)
setDownloadEnabled(downloadYaml, false)
