/// <reference types="vite/client" />

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import {
  MAX_OUTPUT_DIMENSION,
  MAX_OUTPUT_PIXELS,
  PDF_POINTS_PER_INCH,
  PDF_RENDER_DPI,
} from './constants'
import { validatePdfFile } from './validation'

export type PdfRenderErrorCode =
  | 'PASSWORD_PROTECTED'
  | 'CORRUPT_PDF'
  | 'PAGE_COUNT'
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

export interface RenderedPdfPage {
  readonly canvas: HTMLCanvasElement
  readonly width: number
  readonly height: number
  readonly dpi: typeof PDF_RENDER_DPI
}

interface LoadingTaskLike {
  promise: Promise<PdfDocumentLike>
  onPassword: ((updatePassword: (password: string) => void, reason: number) => void) | null
  destroy(): Promise<void>
}

interface PdfDocumentLike {
  readonly numPages: number
  getPage(pageNumber: number): Promise<PdfPageLike>
  destroy(): Promise<void>
}

interface PdfPageLike {
  getViewport(options: { scale: number }): {
    width: number
    height: number
    transform: number[]
  }
  render(options: {
    canvas: HTMLCanvasElement
    viewport: unknown
    background: string
  }): { promise: Promise<void> }
}

/** Converts a PDF.js viewport to safe integer canvas dimensions. */
export function getOutputDimensions(
  viewportWidth: number,
  viewportHeight: number,
): { width: number; height: number } {
  const width = Math.ceil(viewportWidth)
  const height = Math.ceil(viewportHeight)
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_OUTPUT_DIMENSION ||
    height > MAX_OUTPUT_DIMENSION ||
    width * height > MAX_OUTPUT_PIXELS
  ) {
    throw new PdfRenderError(
      'OUTPUT_TOO_LARGE',
      'The rendered PDF exceeds the 20-megapixel or 16,384-pixel dimension limit.',
    )
  }
  return { width, height }
}

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
  return new PdfRenderError(
    'CORRUPT_PDF',
    'The PDF is damaged or could not be decoded.',
    { cause: error },
  )
}

/**
 * Validates and renders the complete, default-visible single PDF page at 150 DPI.
 * Omitting `rotation` from getViewport intentionally preserves the page's own rotation.
 */
export async function renderSinglePagePdf(
  file: File,
  targetCanvas?: HTMLCanvasElement,
): Promise<RenderedPdfPage> {
  await validatePdfFile(file)
  const source = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

  const loadingTask = pdfjs.getDocument({ data: source }) as unknown as LoadingTaskLike
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

  let documentProxy: PdfDocumentLike
  try {
    documentProxy = await Promise.race([loadingTask.promise, passwordRequest])
  } catch (error) {
    try {
      await loadingTask.destroy()
    } catch {
      // Preserve the useful load error.
    }
    throw normalizeLoadError(error)
  }

  try {
    if (documentProxy.numPages !== 1) {
      throw new PdfRenderError(
        'PAGE_COUNT',
        `Choose a one-page PDF. This file contains ${documentProxy.numPages} pages.`,
      )
    }

    const page = await documentProxy.getPage(1)
    const viewport = page.getViewport({
      scale: PDF_RENDER_DPI / PDF_POINTS_PER_INCH,
    })
    const { width, height } = getOutputDimensions(viewport.width, viewport.height)
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

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    try {
      await page.render({
        canvas,
        viewport,
        background: '#ffffff',
      }).promise
    } catch (error) {
      throw new PdfRenderError(
        'RENDER_FAILED',
        'The PDF page could not be rendered.',
        { cause: error },
      )
    }

    return { canvas, width, height, dpi: PDF_RENDER_DPI }
  } catch (error) {
    if (error instanceof PdfRenderError) throw error
    throw new PdfRenderError(
      'RENDER_FAILED',
      'The PDF page could not be rendered.',
      { cause: error },
    )
  } finally {
    try {
      await documentProxy.destroy()
    } catch {
      // Cleanup failure does not invalidate an otherwise generated preview.
    }
  }
}
