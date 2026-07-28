import { fileURLToPath } from 'node:url'

import type { CanvasKit } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { SkiaRenderer } from '#core/canvas'
import { finishExportProfile, startExportProfile } from '#core/io/export-profile'

import { renderNodesToImage, renderThumbnail, type ExportFormat } from './render'

let cachedCk: CanvasKit | null = null
let cachedRenderer: SkiaRenderer | null = null

export interface HeadlessRenderBatch {
  nodeIds: string[]
  options?: {
    scale?: number
    format?: ExportFormat
    quality?: number
    trimTransparent?: boolean
  }
}

export async function initCanvasKit(): Promise<CanvasKit> {
  if (cachedCk) return cachedCk
  const span = startExportProfile('canvaskit_init')
  const CanvasKitInit = (await import('canvaskit-wasm/full')).default
  const ckPath = import.meta.resolve('canvaskit-wasm/full')
  const binDir = fileURLToPath(new URL('.', ckPath))
  cachedCk = await CanvasKitInit({ locateFile: (file: string) => binDir + file })
  finishExportProfile(span)
  return cachedCk
}

async function getRenderer(): Promise<{ ck: CanvasKit; renderer: SkiaRenderer }> {
  const ck = await initCanvasKit()
  if (cachedRenderer) return { ck, renderer: cachedRenderer }

  const rendererSpan = startExportProfile('renderer_init')
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('Failed to create CanvasKit surface')
  const renderer = new SkiaRenderer(ck, surface)
  renderer.viewportWidth = 1
  renderer.viewportHeight = 1
  renderer.dpr = 1
  finishExportProfile(rendererSpan)

  const fontSpan = startExportProfile('font_load', { stage: 'renderer_init' })
  await renderer.loadFonts()
  finishExportProfile(fontSpan, { stage: 'renderer_init' })
  cachedRenderer = renderer
  return { ck, renderer }
}

export async function headlessRenderNodes(
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[],
  options: {
    scale?: number
    format?: ExportFormat
    quality?: number
    trimTransparent?: boolean
  } = {}
): Promise<Uint8Array | null> {
  const [result] = await headlessRenderNodeBatches(graph, pageId, [{ nodeIds, options }])
  return result ?? null
}

export async function headlessRenderNodeBatches(
  graph: SceneGraph,
  pageId: string,
  batches: HeadlessRenderBatch[]
): Promise<(Uint8Array | null)[]> {
  if (batches.length === 0) return []
  const { ck, renderer } = await getRenderer()
  const invalidationSpan = startExportProfile('picture_invalidation')
  renderer.invalidateAllPictures()
  finishExportProfile(invalidationSpan)
  const nodeIds = [...new Set(batches.flatMap((batch) => batch.nodeIds))]
  const restoreTextMeasurer = await renderer.prepareForExport(graph, pageId, nodeIds)
  try {
    return batches.map((batch, batchIndex) => {
      const batchSpan = startExportProfile('batch_item', {
        batch_index: batchIndex,
        nodes: batch.nodeIds.length
      })
      const result = renderNodesToImage(ck, renderer, graph, pageId, batch.nodeIds, {
        scale: batch.options?.scale ?? 1,
        format: batch.options?.format ?? 'PNG',
        quality: batch.options?.quality,
        trimTransparent: batch.options?.trimTransparent
      })
      finishExportProfile(batchSpan, { bytes: result?.byteLength ?? 0 })
      return result
    })
  } finally {
    restoreTextMeasurer()
  }
}

export async function headlessRenderThumbnail(
  graph: SceneGraph,
  pageId: string,
  width: number,
  height: number
): Promise<Uint8Array | null> {
  const { ck, renderer } = await getRenderer()
  renderer.invalidateAllPictures()
  return renderThumbnail(ck, renderer, graph, pageId, width, height)
}
