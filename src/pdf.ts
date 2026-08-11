/// <reference types="vite/client" />

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
} from 'pdfjs-dist'

import {
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
  PDF_INSPECTION_DPI,
  PDF_POINTS_PER_INCH,
} from './constants'
import {
  computeMetricPaddingPixels,
  detectDifferenceBounds,
  expandAndClampBounds,
  scaleBoundsBetweenViewports,
  type PixelBounds,
} from './crop'
import {
  extractDoorGeometry,
  type DoorClosure,
  type DoorGeometryDiagnostics,
  type DoorOperatorCodes,
} from './door-geometry'
import {
  classifyMainHallways,
  OCCUPANCY_PALETTE,
  type OccupancyClassification,
  type PixelDoorSegment,
} from './occupancy'
import { calculateRenderDpi, detectScale } from './scale'
import {
  classifySfuLayer,
  normalizeLayerSuffix,
  type SfuLayerAction,
  type SfuLayerRole,
} from './sfu-profile'
import { validatePdfFile } from './validation'

export type PdfRenderErrorCode =
  | 'PASSWORD_PROTECTED'
  | 'CORRUPT_PDF'
  | 'PAGE_COUNT'
  | 'SCALE_MISSING'
  | 'SCALE_AMBIGUOUS'
  | 'SCALE_UNSUPPORTED'
  | 'OUTPUT_TOO_LARGE'
  | 'CANVAS_UNAVAILABLE'
  | 'RENDER_FAILED'

export class PdfRenderError extends Error {
  readonly code: PdfRenderErrorCode

  constructor(code: PdfRenderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PdfRenderError'
    this.code = code
  }
}

export interface PdfLayerInspection {
  readonly id: string
  readonly name: string
  readonly suffix: string
  readonly initiallyVisible: boolean
  readonly role: SfuLayerRole
  readonly action: SfuLayerAction
  readonly known: boolean
}

export interface AppliedCrop extends PixelBounds {
  readonly fullWidth: number
  readonly fullHeight: number
}

export interface RenderedPdfPage {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  readonly dpi: number
  readonly scaleDenominator: number
  readonly profileRecognized: boolean
  readonly layers: readonly PdfLayerInspection[]
  readonly removedLayerNames: readonly string[]
  readonly closedDoorCount: number
  readonly unmatchedDoorCurveCount: number
  readonly doorCleanupApplied: boolean
  readonly doorDiagnostics: DoorGeometryDiagnostics | null
  readonly occupancy: OccupancyClassification | null
  readonly crop: AppliedCrop | null
  readonly warnings: readonly string[]
}

interface OptionalContentGroupLike {
  readonly name?: string | null
  readonly visible?: boolean
}

type OptionalContentConfigLike = Awaited<
  ReturnType<PDFDocumentProxy['getOptionalContentConfig']>
>

interface CanvasLimits {
  readonly maxPixels: number
  readonly maxDimension: number
}

const INSPECTION_CANVAS_LIMITS: CanvasLimits = {
  maxPixels: 4_000_000,
  maxDimension: 8_192,
}

const OUTPUT_CANVAS_LIMITS: CanvasLimits = {
  maxPixels: MAX_OUTPUT_PIXELS,
  maxDimension: MAX_OUTPUT_DIMENSION,
}

const SFU_REQUIRED_LAYER_SUFFIXES = [
  'AWA',
  'ASHTT',
  'SGR',
  'SGRID',
  'SGRDI',
  'RM$TXT',
  'BBY-SFU-NORTH',
] as const

// These layers describe physical building geometry in the inspected SFU
// corpus. AFLOV, X-REF1, IDs, dimensions, and unknown groups do not seed the
// building bounds. A second retained-content pass below still expands those
// bounds when necessary so visible output is never clipped.
const CROP_SEED_SUFFIXES = new Set([
  'ADO',
  'AFL',
  'AFLPT',
  'AFLSP',
  'AFLST',
  'AFLTE',
  'AFLWD',
  'AGL',
  'ASTRF',
  'ASYPA',
  'AWA',
  'AWACO',
  'AWAFU',
  'AWAMO',
  'GROS',
  'MHV',
])

const AUTO_CROP_PADDING_METRES = 1

// The inspected SFU corpus also contains real swing doors on glazing and
// floor/wood-detail layers. Those layers carry other useful geometry, so they
// stay visible and only confidently matched door paths are overpainted.
const AUXILIARY_DOOR_LAYER_SUFFIXES = new Set(['AGL', 'AFLWD'])
const MIN_AUXILIARY_DOOR_RADIUS_METRES = 0.45
const MAX_AUXILIARY_DOOR_RADIUS_METRES = 1.5

function normalizeLoadError(error: unknown): PdfRenderError {
  if (error instanceof PdfRenderError) return error
  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException') {
    return new PdfRenderError(
      'PASSWORD_PROTECTED',
      'Password-protected PDFs are not supported.',
      { cause: error },
    )
  }
  if (name === 'InvalidPDFException' || name === 'FormatError') {
    return new PdfRenderError(
      'CORRUPT_PDF',
      'The PDF is damaged or could not be decoded.',
      { cause: error },
    )
  }
  return new PdfRenderError(
    'RENDER_FAILED',
    error instanceof Error ? error.message : 'The PDF page could not be rendered.',
    { cause: error },
  )
}

function canvasDimensions(
  viewportWidth: number,
  viewportHeight: number,
  limits: CanvasLimits | null,
): { width: number; height: number } {
  const width = Math.ceil(viewportWidth)
  const height = Math.ceil(viewportHeight)
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new PdfRenderError(
      'OUTPUT_TOO_LARGE',
      'The PDF has invalid or unsupported page dimensions.',
    )
  }
  if (
    limits &&
    (width > limits.maxDimension ||
      height > limits.maxDimension ||
      width * height > limits.maxPixels)
  ) {
    throw new PdfRenderError(
      'OUTPUT_TOO_LARGE',
      `The processed map exceeds the ${limits.maxPixels.toLocaleString()}-pixel or ${limits.maxDimension.toLocaleString()}-pixel dimension limit.`,
    )
  }
  return { width, height }
}

/** Converts a PDF.js viewport to supported final output dimensions. */
export function getOutputDimensions(
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  return canvasDimensions(viewportWidth, viewportHeight, OUTPUT_CANVAS_LIMITS)
}

function createCanvas(
  width: number,
  height: number,
  targetCanvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = targetCanvas ?? document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  })
  if (!context) {
    throw new PdfRenderError(
      'CANVAS_UNAVAILABLE',
      'The browser could not create a canvas for this PDF.',
    )
  }
  return canvas
}

async function renderCanvas(
  pdfjs: typeof import('pdfjs-dist'),
  page: PDFPageProxy,
  viewport: PageViewport,
  config: OptionalContentConfigLike,
  width: number,
  height: number,
  transform?: number[],
  targetCanvas?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height, targetCanvas)
  try {
    await page.render({
      canvas,
      viewport,
      transform,
      intent: 'display',
      annotationMode: pdfjs.AnnotationMode.DISABLE,
      background: '#ffffff',
      optionalContentConfigPromise: Promise.resolve(config),
    }).promise
  } catch (error) {
    canvas.width = 0
    canvas.height = 0
    throw new PdfRenderError(
      'RENDER_FAILED',
      'The PDF page could not be rendered.',
      { cause: error },
    )
  }
  return canvas
}

async function getOptionalContentConfig(
  pdf: PDFDocumentProxy,
): Promise<OptionalContentConfigLike> {
  return pdf.getOptionalContentConfig({
    intent: 'display',
  })
}

function layerName(id: string, group: OptionalContentGroupLike): string {
  const name = group.name?.trim()
  return name ? name : `Unnamed layer ${id}`
}

function isRecognizedSfuProfile(
  page: PDFPageProxy,
  names: readonly string[],
): boolean {
  const suffixes = new Set(names.map(normalizeLayerSuffix))
  const [x1, y1, x2, y2] = page.view
  const rawWidth = Math.abs((x2 ?? 0) - (x1 ?? 0))
  const rawHeight = Math.abs((y2 ?? 0) - (y1 ?? 0))
  const hasSfuSheetGeometry =
    Math.abs(rawWidth - 1260) <= 2 && Math.abs(rawHeight - 2088) <= 2

  return (
    page.rotate === 270 &&
    hasSfuSheetGeometry &&
    SFU_REQUIRED_LAYER_SUFFIXES.every((suffix) => suffixes.has(suffix)) &&
    names.some((name) => name.normalize('NFKC').trim() === '0')
  )
}

async function inspectLayers(
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
): Promise<{
  profileRecognized: boolean
  layers: PdfLayerInspection[]
}> {
  const config = await getOptionalContentConfig(pdf)
  const rawLayers = [...config].map(([id, group]) => ({
    id,
    name: layerName(id, group),
    initiallyVisible: group.visible !== false,
  }))
  const profileRecognized = isRecognizedSfuProfile(
    page,
    rawLayers.map((layer) => layer.name),
  )

  return {
    profileRecognized,
    layers: rawLayers.map((layer) => {
      const classification = classifySfuLayer(layer.name, {
        profileRecognized,
      })
      return {
        ...layer,
        suffix: classification.suffix,
        role: classification.role,
        action: classification.action,
        known: classification.known,
      }
    }),
  }
}

async function maskConfig(
  pdf: PDFDocumentProxy,
  layers: readonly PdfLayerInspection[],
  includeStructuralLayers: boolean,
): Promise<OptionalContentConfigLike> {
  const config = await getOptionalContentConfig(pdf)
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))

  for (const [id] of config) {
    const layer = layerById.get(id)
    const visible = Boolean(
      includeStructuralLayers &&
        layer?.initiallyVisible &&
        CROP_SEED_SUFFIXES.has(layer.suffix),
    )
    config.setVisibility(id, visible, false)
  }
  return config
}

async function finalConfig(
  pdf: PDFDocumentProxy,
  layers: readonly PdfLayerInspection[],
  hiddenLayerIds: ReadonlySet<string> = new Set(),
): Promise<OptionalContentConfigLike> {
  const config = await getOptionalContentConfig(pdf)
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))
  for (const [id] of config) {
    const action = layerById.get(id)?.action
    if (action === 'remove' || hiddenLayerIds.has(id)) {
      config.setVisibility(id, false, false)
    }
  }
  return config
}

function readCanvas(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new PdfRenderError(
      'CANVAS_UNAVAILABLE',
      'The browser could not inspect the rendered PDF.',
    )
  }
  return context.getImageData(0, 0, canvas.width, canvas.height)
}

function unionBounds(first: PixelBounds, second: PixelBounds): PixelBounds {
  return {
    left: Math.min(first.left, second.left),
    top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right),
    bottom: Math.max(first.bottom, second.bottom),
  }
}

async function proposeCrop(
  pdfjs: typeof import('pdfjs-dist'),
  pdf: PDFDocumentProxy,
  page: PDFPageProxy,
  layers: readonly PdfLayerInspection[],
  scaleDenominator: number,
  resolution: number,
  finalViewport: PageViewport,
): Promise<PixelBounds | null> {
  const inspectionViewport = page.getViewport({
    scale: PDF_INSPECTION_DPI / PDF_POINTS_PER_INCH,
  })
  const inspectionSize = canvasDimensions(
    inspectionViewport.width,
    inspectionViewport.height,
    INSPECTION_CANVAS_LIMITS,
  )

  const baselineCanvas = await renderCanvas(
    pdfjs,
    page,
    inspectionViewport,
    await maskConfig(pdf, layers, false),
    inspectionSize.width,
    inspectionSize.height,
  )
  let structuralCanvas: HTMLCanvasElement | null = null
  let retainedCanvas: HTMLCanvasElement | null = null

  try {
    structuralCanvas = await renderCanvas(
      pdfjs,
      page,
      inspectionViewport,
      await maskConfig(pdf, layers, true),
      inspectionSize.width,
      inspectionSize.height,
    )
    retainedCanvas = await renderCanvas(
      pdfjs,
      page,
      inspectionViewport,
      await finalConfig(pdf, layers),
      inspectionSize.width,
      inspectionSize.height,
    )

    const baselinePixels = readCanvas(baselineCanvas)
    const structuralBounds = detectDifferenceBounds(
      baselinePixels,
      readCanvas(structuralCanvas),
    )
    if (!structuralBounds) return null

    const retainedBounds = detectDifferenceBounds(
      baselinePixels,
      readCanvas(retainedCanvas),
    )
    const inspectionBounds = retainedBounds
      ? unionBounds(structuralBounds, retainedBounds)
      : structuralBounds

    const inspectionWidth = inspectionBounds.right - inspectionBounds.left
    const inspectionHeight = inspectionBounds.bottom - inspectionBounds.top
    if (inspectionWidth < 20 || inspectionHeight < 20) return null

    const fullSize = canvasDimensions(
      finalViewport.width,
      finalViewport.height,
      null,
    )
    const scaled = scaleBoundsBetweenViewports(
      inspectionBounds,
      inspectionSize,
      fullSize,
    )
    const padding = computeMetricPaddingPixels(
      AUTO_CROP_PADDING_METRES,
      scaleDenominator,
      calculateRenderDpi(scaleDenominator, resolution),
    )
    return expandAndClampBounds(
      scaled,
      padding,
      fullSize.width,
      fullSize.height,
    )
  } finally {
    baselineCanvas.width = 0
    baselineCanvas.height = 0
    if (structuralCanvas) {
      structuralCanvas.width = 0
      structuralCanvas.height = 0
    }
    if (retainedCanvas) {
      retainedCanvas.width = 0
      retainedCanvas.height = 0
    }
  }
}

function pdfDoorOperatorCodes(
  pdfjs: typeof import('pdfjs-dist'),
): DoorOperatorCodes {
  return {
    save: pdfjs.OPS.save,
    restore: pdfjs.OPS.restore,
    transform: pdfjs.OPS.transform,
    constructPath: pdfjs.OPS.constructPath,
    beginMarkedContent: pdfjs.OPS.beginMarkedContent,
    beginMarkedContentProps: pdfjs.OPS.beginMarkedContentProps,
    endMarkedContent: pdfjs.OPS.endMarkedContent,
    paintFormXObjectBegin: pdfjs.OPS.paintFormXObjectBegin,
    paintFormXObjectEnd: pdfjs.OPS.paintFormXObjectEnd,
    beginGroup: pdfjs.OPS.beginGroup,
    endGroup: pdfjs.OPS.endGroup,
    stroke: pdfjs.OPS.stroke,
    closeStroke: pdfjs.OPS.closeStroke,
    fillStroke: pdfjs.OPS.fillStroke,
    eoFillStroke: pdfjs.OPS.eoFillStroke,
    closeFillStroke: pdfjs.OPS.closeFillStroke,
    closeEOFillStroke: pdfjs.OPS.closeEOFillStroke,
  }
}

function countUnmatchedDoorCurves(
  diagnostics: DoorGeometryDiagnostics,
): number {
  return (
    diagnostics.rejectedFullCircles +
    diagnostics.rejectedNonCircular +
    diagnostics.rejectedSweep +
    diagnostics.rejectedWithoutLeaf
  )
}

function physicalDoorRadiusMetres(
  closure: DoorClosure,
  scaleDenominator: number,
): number {
  return (
    (closure.radius * scaleDenominator * 0.0254) /
    PDF_POINTS_PER_INCH
  )
}

function isPlausibleAuxiliaryDoor(
  closure: DoorClosure,
  scaleDenominator: number,
): boolean {
  const radiusMetres = physicalDoorRadiusMetres(closure, scaleDenominator)
  return (
    radiusMetres >= MIN_AUXILIARY_DOOR_RADIUS_METRES &&
    radiusMetres <= MAX_AUXILIARY_DOOR_RADIUS_METRES
  )
}

function toCanvasPoint(
  viewport: PageViewport,
  point: { readonly x: number; readonly y: number },
  crop: PixelBounds | null,
): readonly [number, number] {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y) as [
    number,
    number,
  ]
  return [x - (crop?.left ?? 0), y - (crop?.top ?? 0)]
}

function eraseRetainedDoorSymbols(
  canvas: HTMLCanvasElement,
  backgroundCanvas: HTMLCanvasElement,
  closures: readonly DoorClosure[],
  viewport: PageViewport,
  crop: PixelBounds | null,
): void {
  if (closures.length === 0) return
  const context = canvas.getContext('2d')
  if (!context) {
    throw new PdfRenderError(
      'CANVAS_UNAVAILABLE',
      'The browser could not remove the original door symbols.',
    )
  }

  const backgroundPattern = context.createPattern(backgroundCanvas, 'no-repeat')
  if (!backgroundPattern) {
    throw new PdfRenderError(
      'CANVAS_UNAVAILABLE',
      'The browser could not preserve the map beneath the door symbols.',
    )
  }

  context.save()
  context.globalAlpha = 1
  context.strokeStyle = backgroundPattern
  context.fillStyle = backgroundPattern
  context.lineWidth = Math.max(2, viewport.scale * 0.75 + 1)
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (const closure of closures) {
    const firstCubic = closure.sourceArcCubics[0]
    if (firstCubic) {
      const [startX, startY] = toCanvasPoint(
        viewport,
        firstCubic.start,
        crop,
      )
      context.beginPath()
      context.moveTo(startX, startY)
      for (const cubic of closure.sourceArcCubics) {
        const [control1X, control1Y] = toCanvasPoint(
          viewport,
          cubic.control1,
          crop,
        )
        const [control2X, control2Y] = toCanvasPoint(
          viewport,
          cubic.control2,
          crop,
        )
        const [endX, endY] = toCanvasPoint(viewport, cubic.end, crop)
        context.bezierCurveTo(
          control1X,
          control1Y,
          control2X,
          control2Y,
          endX,
          endY,
        )
      }
      context.stroke()
    }

    const firstLeafPoint = closure.sourceLeafVertices[0]
    if (!firstLeafPoint) continue
    const [leafStartX, leafStartY] = toCanvasPoint(
      viewport,
      firstLeafPoint,
      crop,
    )
    context.beginPath()
    context.moveTo(leafStartX, leafStartY)
    for (const point of closure.sourceLeafVertices.slice(1)) {
      const [x, y] = toCanvasPoint(viewport, point, crop)
      context.lineTo(x, y)
    }
    const lastLeafPoint = closure.sourceLeafVertices.at(-1)
    if (
      closure.sourceLeafVertices.length >= 4 &&
      lastLeafPoint &&
      Math.hypot(
        lastLeafPoint.x - firstLeafPoint.x,
        lastLeafPoint.y - firstLeafPoint.y,
      ) <= 0.05
    ) {
      context.fill()
    }
    context.stroke()
  }
  context.restore()
}

function drawClosedDoors(
  canvas: HTMLCanvasElement,
  closures: readonly DoorClosure[],
  viewport: PageViewport,
  crop: PixelBounds | null,
  resolution: number,
): void {
  if (closures.length === 0) return
  const context = canvas.getContext('2d')
  if (!context) {
    throw new PdfRenderError(
      'CANVAS_UNAVAILABLE',
      'The browser could not draw the closed door barriers.',
    )
  }

  context.save()
  context.globalAlpha = 1
  context.strokeStyle = '#000000'
  context.lineWidth = Math.max(2, 0.1 / resolution)
  context.lineCap = 'square'
  context.lineJoin = 'miter'
  context.beginPath()
  for (const closure of closures) {
    const [hingeX, hingeY] = toCanvasPoint(viewport, closure.hinge, crop)
    const [closedX, closedY] = toCanvasPoint(
      viewport,
      closure.closedEnd,
      crop,
    )
    if (
      !Number.isFinite(hingeX) ||
      !Number.isFinite(hingeY) ||
      !Number.isFinite(closedX) ||
      !Number.isFinite(closedY)
    ) {
      continue
    }
    context.moveTo(hingeX, hingeY)
    context.lineTo(closedX, closedY)
  }
  context.stroke()
  context.restore()
}

function pixelDoorSegments(
  closures: readonly DoorClosure[],
  viewport: PageViewport,
  crop: PixelBounds | null,
): PixelDoorSegment[] {
  return closures.map((closure) => {
    const [ax, ay] = toCanvasPoint(viewport, closure.hinge, crop)
    const [bx, by] = toCanvasPoint(viewport, closure.closedEnd, crop)
    return { ax, ay, bx, by }
  })
}

function paintOccupancyCanvas(
  canvas: HTMLCanvasElement,
  source: ImageData,
  occupancy: OccupancyClassification,
): void {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new PdfRenderError(
      'CANVAS_UNAVAILABLE',
      'The browser could not draw the hallway occupancy map.',
    )
  }
  for (let pixel = 0; pixel < occupancy.pixels.length; pixel += 1) {
    const value = occupancy.pixels[pixel] ?? OCCUPANCY_PALETTE.excluded
    const offset = pixel * 4
    source.data[offset] = value
    source.data[offset + 1] = value
    source.data[offset + 2] = value
    source.data[offset + 3] = 255
  }
  context.putImageData(source, 0, 0)
}

function requireDetectedScale(textFragments: readonly string[]): number {
  const detection = detectScale(textFragments)
  if (detection.status === 'detected') return detection.denominator
  if (detection.status === 'missing') {
    throw new PdfRenderError(
      'SCALE_MISSING',
      'The printed drawing scale could not be detected in this PDF.',
    )
  }
  if (detection.status === 'unsupported') {
    throw new PdfRenderError(
      'SCALE_UNSUPPORTED',
      `This PDF uses unsupported scale 1:${detection.candidates[0]}. Supported SFU scales are 1:250 and 1:400.`,
    )
  }
  throw new PdfRenderError(
    'SCALE_AMBIGUOUS',
    `More than one printed scale was found (${detection.candidates.map((value) => `1:${value}`).join(', ')}).`,
  )
}

/**
 * Inspects, cleans, crops, and scale-calibrates one SFU schematic PDF.
 * Unknown and stair layers retain their original visibility. Recognized swing
 * symbols are removed and replaced by opaque barriers in closed positions.
 */
export async function renderSinglePagePdf(
  file: File,
  resolution: number,
  targetCanvas?: HTMLCanvasElement,
): Promise<RenderedPdfPage> {
  await validatePdfFile(file)
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new PdfRenderError(
      'RENDER_FAILED',
      'Map resolution must be greater than zero before rendering.',
    )
  }

  const source = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const loadingTask = pdfjs.getDocument({ data: source }) as PDFDocumentLoadingTask
  const passwordRequest = new Promise<never>((_resolve, reject) => {
    loadingTask.onPassword = () => {
      reject(
        new PdfRenderError(
          'PASSWORD_PROTECTED',
          'Password-protected PDFs are not supported.',
        ),
      )
    }
  })

  let pdf: PDFDocumentProxy | null = null
  try {
    pdf = await Promise.race([loadingTask.promise, passwordRequest])
    if (pdf.numPages !== 1) {
      throw new PdfRenderError(
        'PAGE_COUNT',
        `Choose a one-page PDF. This file contains ${pdf.numPages} pages.`,
      )
    }

    const page = await pdf.getPage(1)
    const textContent = await page.getTextContent()
    const textFragments = textContent.items
      .filter((item): item is typeof item & { str: string } => 'str' in item)
      .map((item) => item.str)
    const scaleDenominator = requireDetectedScale(textFragments)
    const { profileRecognized, layers } = await inspectLayers(pdf, page)
    const adoLayerIds = new Set(
      layers
        .filter(
          (layer) =>
            profileRecognized &&
            layer.action === 'replace' &&
            layer.initiallyVisible,
        )
        .map((layer) => layer.id),
    )
    const auxiliaryDoorLayerIds = new Set(
      layers
        .filter(
          (layer) =>
            profileRecognized &&
            layer.initiallyVisible &&
            AUXILIARY_DOOR_LAYER_SUFFIXES.has(layer.suffix),
        )
        .map((layer) => layer.id),
    )
    const operatorList =
      adoLayerIds.size > 0 || auxiliaryDoorLayerIds.size > 0
        ? await page.getOperatorList({
            intent: 'display',
            annotationMode: pdfjs.AnnotationMode.DISABLE,
          })
        : null
    const operatorCodes = pdfDoorOperatorCodes(pdfjs)
    const doorGeometry =
      adoLayerIds.size > 0 && operatorList
        ? extractDoorGeometry(operatorList, {
              adoLayerIds,
              operatorCodes,
            })
        : null
    const auxiliaryDoorGeometry =
      auxiliaryDoorLayerIds.size > 0 && operatorList
        ? extractDoorGeometry(operatorList, {
            adoLayerIds: auxiliaryDoorLayerIds,
            operatorCodes,
          })
        : null
    const auxiliaryDoorClosures =
      auxiliaryDoorGeometry?.closures.filter((closure) =>
        isPlausibleAuxiliaryDoor(closure, scaleDenominator),
      ) ?? []
    const auxiliaryDoorSourceMatches =
      auxiliaryDoorGeometry?.sourceMatches.filter((closure) =>
        isPlausibleAuxiliaryDoor(closure, scaleDenominator),
      ) ?? []
    const primaryDoorClosures = doorGeometry?.closures ?? []
    const doorClosures = [...primaryDoorClosures, ...auxiliaryDoorClosures]
    const doorSourceMatches = [
      ...(doorGeometry?.sourceMatches ?? []),
      ...auxiliaryDoorSourceMatches,
    ]
    const doorCleanupApplied = doorClosures.length > 0
    const unmatchedDoorCurveCount = doorGeometry
      ? countUnmatchedDoorCurves(doorGeometry.diagnostics)
      : 0
    const dpi = calculateRenderDpi(scaleDenominator, resolution)
    const fullViewport = page.getViewport({
      scale: dpi / PDF_POINTS_PER_INCH,
    })
    const fullSize = canvasDimensions(
      fullViewport.width,
      fullViewport.height,
      null,
    )
    const warnings: string[] = []
    if (adoLayerIds.size > 0 && primaryDoorClosures.length === 0) {
      warnings.push(
        'No confident hinged-door geometry was found; the original ADO layer was retained.',
      )
    } else if (unmatchedDoorCurveCount > 0) {
      const curveLabel = `ADO curve${unmatchedDoorCurveCount === 1 ? '' : 's'}`
      warnings.push(
        `${unmatchedDoorCurveCount} ${curveLabel} did not match a hinged door and remained unchanged for review.`,
      )
    }

    let cropBounds: PixelBounds | null = null
    if (profileRecognized) {
      cropBounds = await proposeCrop(
        pdfjs,
        pdf,
        page,
        layers,
        scaleDenominator,
        resolution,
        fullViewport,
      )
      if (
        cropBounds?.left === 0 &&
        cropBounds.top === 0 &&
        cropBounds.right === fullSize.width &&
        cropBounds.bottom === fullSize.height
      ) {
        cropBounds = null
      }
      if (!cropBounds) {
        warnings.push('Building bounds were not detected; the full sheet was retained.')
      }
    } else {
      warnings.push(
        'This PDF does not match the verified SFU layer profile; no layers were removed and the full sheet was retained.',
      )
    }

    const renderBounds = cropBounds ?? {
      left: 0,
      top: 0,
      right: fullSize.width,
      bottom: fullSize.height,
    }
    const outputSize = getOutputDimensions(
      renderBounds.right - renderBounds.left,
      renderBounds.bottom - renderBounds.top,
    )
    const canvas = await renderCanvas(
      pdfjs,
      page,
      fullViewport,
      await finalConfig(pdf, layers),
      outputSize.width,
      outputSize.height,
      cropBounds
        ? [1, 0, 0, 1, -cropBounds.left, -cropBounds.top]
        : undefined,
      targetCanvas,
    )
    if (doorCleanupApplied) {
      const doorSourceLayerIds = new Set(
        doorSourceMatches.map((closure) => closure.sourceLayerId),
      )
      const backgroundCanvas = await renderCanvas(
        pdfjs,
        page,
        fullViewport,
        await finalConfig(pdf, layers, doorSourceLayerIds),
        outputSize.width,
        outputSize.height,
        cropBounds
          ? [1, 0, 0, 1, -cropBounds.left, -cropBounds.top]
          : undefined,
      )
      try {
        eraseRetainedDoorSymbols(
          canvas,
          backgroundCanvas,
          doorSourceMatches,
          fullViewport,
          cropBounds,
        )
      } finally {
        backgroundCanvas.width = 0
        backgroundCanvas.height = 0
      }
    }
    if (doorCleanupApplied) {
      drawClosedDoors(canvas, doorClosures, fullViewport, cropBounds, resolution)
    }
    let occupancy: OccupancyClassification | null = null
    if (profileRecognized) {
      const occupancySource = readCanvas(canvas)
      occupancy = classifyMainHallways(occupancySource, {
        resolution,
        doorSegments: pixelDoorSegments(
          doorClosures,
          fullViewport,
          cropBounds,
        ),
      })
      paintOccupancyCanvas(canvas, occupancySource, occupancy)
      if (!occupancy.diagnostics.applied && occupancy.diagnostics.reason) {
        warnings.push(occupancy.diagnostics.reason)
      }
    }
    const removedLayerNames = layers
      .filter((layer) => layer.action === 'remove')
      .map((layer) => layer.name)

    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      dpi,
      scaleDenominator,
      profileRecognized,
      layers,
      removedLayerNames,
      closedDoorCount: doorClosures.length,
      unmatchedDoorCurveCount,
      doorCleanupApplied,
      doorDiagnostics: doorGeometry?.diagnostics ?? null,
      occupancy,
      crop: cropBounds
        ? { ...cropBounds, fullWidth: fullSize.width, fullHeight: fullSize.height }
        : null,
      warnings,
    }
  } catch (error) {
    throw normalizeLoadError(error)
  } finally {
    try {
      await loadingTask.destroy()
    } catch {
      // Cleanup failure does not invalidate an otherwise completed render.
    }
  }
}
