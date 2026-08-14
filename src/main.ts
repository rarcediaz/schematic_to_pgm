import './style.css'

import { MAP_DEFAULTS } from './constants'
import { renderSinglePagePdf, type RenderedPdfPage } from './pdf'
import { occupancyMapDataToPgmBlob } from './pgm'
import {
  ValidationError,
  validateMapSettings,
  validateResolution,
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
const dpiBadge = getElement<HTMLSpanElement>('dpi-badge')
let previewCanvas = getElement<HTMLCanvasElement>('preview-canvas')
const occupancyLegend = getElement<HTMLUListElement>('occupancy-legend')
const previewCaption = getElement<HTMLElement>('preview-caption')
const outputDetails = getElement<HTMLDivElement>('output-details')
const outputDetailsText = (() => {
  const element = outputDetails.querySelector<HTMLParagraphElement>('p')
  if (!element) throw new Error('Missing output details text.')
  return element
})()

interface PdfProcessRequest {
  file: File
  resolutionValue: string
  token: number
}

let pdfReady = false
let selectionToken = 0
let settingsVersion = 0
let selectedPdfFile: File | null = null
let renderedPdf: RenderedPdfPage | null = null
let reprocessTimer: ReturnType<typeof setTimeout> | null = null
let pendingPdfProcess: PdfProcessRequest | null = null
let pdfProcessWorker: Promise<void> | null = null
let pgmUrl: string | null = null
let yamlUrl: string | null = null
let hasGeneratedFiles = false

function cancelScheduledReprocess(): void {
  if (!reprocessTimer) return
  clearTimeout(reprocessTimer)
  reprocessTimer = null
}

function setStatus(
  message: string,
  state: 'neutral' | 'success' | 'error' = 'neutral',
): void {
  statusMessage.dataset.state = state
  statusMessage.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite')
  statusMessage.textContent = message
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function formatDpi(dpi: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(dpi)
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
  renderedPdf = null
  previewCanvas.hidden = true
  previewCanvas.width = 0
  previewCanvas.height = 0
  previewPlaceholder.hidden = false
  dpiBadge.textContent = 'DPI pending'
  occupancyLegend.hidden = false
  previewCaption.textContent =
    'Review your processed map before downloading. White areas are available for navigation; shaded areas are blocked.'
  outputDetailsText.textContent =
    'Map dimensions will appear after processing.'
}

function currentSettings(): ValidatedMapSettings {
  return validateMapSettings({
    baseFilename: baseFilenameInput.value,
    resolution: resolutionInput.value,
    originX: originXInput.value,
    originY: originYInput.value,
  })
}

function canExportRenderedMap(): boolean {
  return Boolean(
    pdfReady &&
      renderedPdf?.profileRecognized &&
      renderedPdf.occupancy?.diagnostics.applied,
  )
}

function updateOutputDetails(): void {
  if (
    !pdfReady ||
    !renderedPdf ||
    previewCanvas.width === 0 ||
    previewCanvas.height === 0
  ) {
    return
  }

  const resolution = Number(resolutionInput.value)
  const pixelDescription = `${previewCanvas.width.toLocaleString()} × ${previewCanvas.height.toLocaleString()} px`

  if (!Number.isFinite(resolution) || resolution <= 0) {
    outputDetailsText.textContent = pixelDescription
    return
  }

  const widthMetres = previewCanvas.width * resolution
  const heightMetres = previewCanvas.height * resolution
  const metres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
  outputDetailsText.textContent = `${pixelDescription} · ${metres.format(widthMetres)} × ${metres.format(heightMetres)} m · ${resolution} m/px`
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

function processingSummary(rendered: RenderedPdfPage): string {
  const summary = rendered.occupancy?.diagnostics.applied
    ? 'Your processed map is ready. Review the preview, then generate your files.'
    : 'We could not create a reliable map from this PDF. Try another floor plan.'
  const warning = rendered.warnings.join(' ')
  return warning ? `${summary} ${warning}` : summary
}

async function runPdfProcess(request: PdfProcessRequest): Promise<void> {
  const { file, resolutionValue, token } = request
  try {
    const resolution = validateResolution(resolutionValue)
    const rendered = await renderSinglePagePdf(file, resolution)
    if (token !== selectionToken) {
      rendered.canvas.width = 0
      rendered.canvas.height = 0
      return
    }

    rendered.canvas.id = 'preview-canvas'
    rendered.canvas.hidden = false
    rendered.canvas.setAttribute('role', 'img')
    rendered.canvas.setAttribute(
      'aria-label',
      rendered.profileRecognized
        ? `Hallway occupancy map preview of ${file.name}: white is free hallway, black is a barrier, light gray is a blocked room, and dark gray is blocked exterior or reference detail`
        : `Raw diagnostic preview of unsupported PDF ${file.name}; map export is unavailable`,
    )
    previewCanvas.replaceWith(rendered.canvas)
    previewCanvas = rendered.canvas
    previewPlaceholder.hidden = true
    renderedPdf = rendered
    pdfReady = true
    generateButton.disabled = !canExportRenderedMap()
    occupancyLegend.hidden = !rendered.profileRecognized
    previewCaption.textContent = rendered.profileRecognized
      ? 'Review your processed map before downloading. White areas are available for navigation; shaded areas are blocked.'
      : 'This floor plan could not be converted. Try another single-page SFU schematic.'
    dpiBadge.textContent = `${formatDpi(rendered.dpi)} DPI`
    fileDetails.textContent = `${file.name} · ${formatFileSize(file.size)} · 1 page · scale 1:${rendered.scaleDenominator}`
    updateOutputDetails()
    setStatus(
      processingSummary(rendered),
      !rendered.occupancy?.diagnostics.applied
        ? 'error'
        : rendered.warnings.length === 0
          ? 'success'
          : 'neutral',
    )
  } catch (error) {
    if (token !== selectionToken) return
    const message =
      error instanceof Error ? error.message : 'The PDF could not be processed.'
    fileDetails.textContent = `${file.name} · could not be processed`
    setStatus(message, 'error')
    if (error instanceof ValidationError) {
      focusValidationField(error)
    } else {
      pdfInput.focus()
    }
  } finally {
    if (token === selectionToken) {
      pdfInput.disabled = false
      form.removeAttribute('aria-busy')
    }
  }
}

async function drainPdfProcessQueue(): Promise<void> {
  try {
    while (pendingPdfProcess) {
      const request = pendingPdfProcess
      pendingPdfProcess = null

      if (request.token === selectionToken) {
        await runPdfProcess(request)
      }
    }
  } finally {
    pdfProcessWorker = null
  }
}

function processPdf(file: File): Promise<void> {
  const token = ++selectionToken
  pendingPdfProcess = {
    file,
    resolutionValue: resolutionInput.value,
    token,
  }

  pdfReady = false
  generateButton.disabled = true
  clearGeneratedFiles()
  resetPreview()
  pdfInput.disabled = true
  form.setAttribute('aria-busy', 'true')
  fileDetails.textContent = `${file.name} · ${formatFileSize(file.size)}`
  setStatus(
    'Detecting scale, cleaning SFU layers, closing doors, and finding main hallways…',
  )

  if (!pdfProcessWorker) {
    pdfProcessWorker = drainPdfProcessQueue()
  }
  return pdfProcessWorker
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
    setStatus('Choose and process a one-page PDF before generating files.', 'error')
    pdfInput.focus()
    return
  }
  if (!renderedPdf?.profileRecognized) {
    setStatus(
      'This PDF is outside the verified SFU profile. Raw preview is available for diagnosis, but map export is disabled.',
      'error',
    )
    return
  }
  if (!renderedPdf.occupancy?.diagnostics.applied) {
    setStatus(
      'No hallway region passed the safety checks. Map export is disabled.',
      'error',
    )
    return
  }
  const generationRender = renderedPdf
  const generationOccupancy = renderedPdf.occupancy

  clearGeneratedFiles()
  generateButton.disabled = true
  generateButton.textContent = 'Generating…'
  form.setAttribute('aria-busy', 'true')
  setStatus('Encoding the trinary hallway occupancy map…')

  try {
    const generationVersion = settingsVersion
    const generationCanvas = previewCanvas
    const settings = currentSettings()
    baseFilenameInput.value = settings.baseFilename

    // Let the loading message paint before the synchronous pixel conversion.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    if (
      generationVersion !== settingsVersion ||
      !pdfReady ||
      previewCanvas !== generationCanvas ||
      renderedPdf !== generationRender
    ) {
      if (pdfReady) {
        setStatus('Settings changed. Generate the files again to update them.')
      }
      return
    }

    const pgmBlob = occupancyMapDataToPgmBlob({
      width: generationOccupancy.width,
      height: generationOccupancy.height,
      data: generationOccupancy.mapPixels,
    })
    const yamlBlob = createMapYamlBlob(settings)
    installDownloads(settings, pgmBlob, yamlBlob)
    updateOutputDetails()
    const warnings = generationRender?.warnings.join(' ') ?? ''
    setStatus(
      `Generated ${settings.baseFilename}.pgm and ${settings.baseFilename}.yaml.${warnings ? ` ${warnings}` : ''}`,
      warnings ? 'neutral' : 'success',
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
    generateButton.disabled = !canExportRenderedMap()
    generateButton.textContent = 'Generate map files'
    if (!pdfProcessWorker) {
      form.removeAttribute('aria-busy')
    }
  }
}

function scheduleResolutionReprocess(): void {
  settingsVersion += 1
  clearGeneratedFiles()
  if (!selectedPdfFile) {
    updateOutputDetails()
    return
  }

  selectionToken += 1
  pdfReady = false
  generateButton.disabled = true
  cancelScheduledReprocess()

  try {
    validateResolution(resolutionInput.value)
    setStatus('Resolution changed. Reprocessing the calibrated map…')
    reprocessTimer = setTimeout(() => {
      reprocessTimer = null
      if (selectedPdfFile) void processPdf(selectedPdfFile)
    }, 350)
  } catch (error) {
    pdfInput.disabled = false
    form.removeAttribute('aria-busy')
    setStatus(
      error instanceof Error ? error.message : 'Enter a valid resolution.',
      'error',
    )
    if (error instanceof ValidationError) {
      focusValidationField(error)
    } else {
      resolutionInput.focus()
    }
  }
}

pdfInput.addEventListener('change', () => {
  settingsVersion += 1
  cancelScheduledReprocess()
  selectedPdfFile = pdfInput.files?.[0] ?? null
  if (!selectedPdfFile) {
    selectionToken += 1
    pdfReady = false
    clearGeneratedFiles()
    resetPreview()
    fileDetails.textContent = 'No PDF selected'
    setStatus('Select a PDF to begin.')
    return
  }
  void processPdf(selectedPdfFile)
})

form.addEventListener('submit', (event) => {
  void handleGenerate(event)
})

resolutionInput.addEventListener('input', scheduleResolutionReprocess)

for (const input of [baseFilenameInput, originXInput, originYInput]) {
  input.addEventListener('input', () => {
    settingsVersion += 1
    clearGeneratedFiles(true)
    updateOutputDetails()
  })
}

window.addEventListener('beforeunload', () => {
  cancelScheduledReprocess()
  revokeDownloadUrls()
})

baseFilenameInput.value = MAP_DEFAULTS.baseFilename
resolutionInput.value = String(MAP_DEFAULTS.resolution)
originXInput.value = MAP_DEFAULTS.originX.toFixed(1)
originYInput.value = MAP_DEFAULTS.originY.toFixed(1)
setDownloadEnabled(downloadPgm, false)
setDownloadEnabled(downloadYaml, false)
