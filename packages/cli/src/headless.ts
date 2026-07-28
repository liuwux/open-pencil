import { readFile } from 'node:fs/promises'

import {
  BUILTIN_IO_FORMATS,
  finishExportProfile,
  IORegistry,
  initCanvasKit,
  startExportProfile
} from '@open-pencil/core/io'
import { populateAllLazyFigImportRoots, populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph } from '@open-pencil/scene-graph'

export { initCanvasKit }

const io = new IORegistry(BUILTIN_IO_FORMATS)

export async function loadDocument(filePath: string): Promise<SceneGraph> {
  const readSpan = startExportProfile('file_read')
  const bytes = new Uint8Array(await readFile(filePath))
  finishExportProfile(readSpan, { bytes: bytes.byteLength })

  const decodeSpan = startExportProfile('fig_decode', { bytes: bytes.byteLength })
  const { graph } = await io.readDocument({ name: filePath, data: bytes })
  finishExportProfile(decodeSpan, { nodes: graph.nodes.size })

  const layoutSpan = startExportProfile('layout', { stage: 'initial_document' })
  computeAllLayouts(graph)
  finishExportProfile(layoutSpan, { nodes: graph.nodes.size, stage: 'initial_document' })
  return graph
}

export function populateDocumentPage(graph: SceneGraph, pageId: string): boolean {
  const populationSpan = startExportProfile('lazy_population', { scope: 'page' })
  const changed = populateLazyFigImportRoots(graph, [pageId])
  finishExportProfile(populationSpan, { changed, nodes: graph.nodes.size, scope: 'page' })
  if (changed) {
    const layoutSpan = startExportProfile('layout', { stage: 'populated_page' })
    computeAllLayouts(graph, pageId)
    finishExportProfile(layoutSpan, { nodes: graph.nodes.size, stage: 'populated_page' })
  }
  return changed
}

export function populateWholeDocument(graph: SceneGraph): boolean {
  const populationSpan = startExportProfile('lazy_population', { scope: 'document' })
  const changed = populateAllLazyFigImportRoots(graph)
  finishExportProfile(populationSpan, { changed, nodes: graph.nodes.size, scope: 'document' })
  if (changed) {
    const layoutSpan = startExportProfile('layout', { stage: 'populated_document' })
    computeAllLayouts(graph)
    finishExportProfile(layoutSpan, { nodes: graph.nodes.size, stage: 'populated_document' })
  }
  return changed
}

function findNodePageId(graph: SceneGraph, nodeId: string): string | null {
  let node = graph.getNode(nodeId)
  while (node) {
    if (node.type === 'CANVAS') return node.id
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return null
}

export function populateDocumentNodes(
  graph: SceneGraph,
  nodeIds: string[],
  pageName?: string
): Map<string, string[]> {
  const requestedPage = pageName
    ? graph.getPages(true).find((page) => page.name === pageName)
    : undefined
  if (pageName && !requestedPage) throw new Error(`Page "${pageName}" not found`)
  if (requestedPage) populateDocumentPage(graph, requestedPage.id)

  if (nodeIds.some((nodeId) => !graph.getNode(nodeId))) {
    if (requestedPage) {
      const missing = nodeIds.filter((nodeId) => !graph.getNode(nodeId))
      throw new Error(`Nodes not found on page "${pageName}": ${missing.join(', ')}`)
    }
    populateWholeDocument(graph)
  }

  const byPage = new Map<string, string[]>()
  for (const nodeId of nodeIds) {
    const pageId = findNodePageId(graph, nodeId)
    if (!pageId) throw new Error(`Node not found: ${nodeId}`)
    if (requestedPage && pageId !== requestedPage.id) {
      throw new Error(`Node ${nodeId} is not on page "${pageName}"`)
    }
    const pageNodeIds = byPage.get(pageId) ?? []
    pageNodeIds.push(nodeId)
    byPage.set(pageId, pageNodeIds)
  }

  for (const pageId of byPage.keys()) populateDocumentPage(graph, pageId)
  return byPage
}

function pageNameFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const page = (args as { page?: unknown }).page
  return typeof page === 'string' ? page : undefined
}

function populateRequestedPage(graph: SceneGraph, pageName?: string): void {
  const pages = graph.getPages()
  const page = pageName ? pages.find((candidate) => candidate.name === pageName) : pages[0]
  if (page) populateDocumentPage(graph, page.id)
}

export function prepareDocumentForRpc(graph: SceneGraph, command: string, args?: unknown): void {
  if (command === 'pages' || command === 'variables') return
  if (command === 'tree') {
    populateRequestedPage(graph, pageNameFromArgs(args))
    return
  }
  if (command === 'find' || command === 'query') {
    const pageName = pageNameFromArgs(args)
    if (pageName) populateRequestedPage(graph, pageName)
    else populateWholeDocument(graph)
    return
  }
  populateWholeDocument(graph)
}
