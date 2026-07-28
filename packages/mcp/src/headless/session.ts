import { readFile, writeFile } from 'node:fs/promises'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { BUILTIN_IO_FORMATS, headlessRenderNodes, IORegistry } from '@open-pencil/core/io'
import { populateAllLazyFigImportRoots, populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { executeRpcCommand } from '@open-pencil/core/rpc'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { assertLocalFonts, configureHeadlessFonts } from '#mcp/headless/fonts'

export type HeadlessDocumentLoader = (filePath: string) => Promise<SceneGraph>

type JsonArguments = Record<string, unknown>

function isJsonArguments(value: unknown): value is JsonArguments {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export type HeadlessSessionStatus = {
  state: 'unloaded' | 'loading' | 'ready' | 'failed'
  loadCount: number
  loadMs?: number
  nodes?: number
  error?: string
}

async function defaultLoader(filePath: string): Promise<SceneGraph> {
  const bytes = new Uint8Array(await readFile(filePath))
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const { graph } = await io.readDocument({ name: filePath, data: bytes })
  computeAllLayouts(graph)
  return graph
}

function requestedPageName(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined
  const page = (args as { page?: unknown }).page
  return typeof page === 'string' ? page : undefined
}

function populatePage(graph: SceneGraph, pageName?: string): void {
  const pages = graph.getPages()
  const page = pageName ? pages.find((candidate) => candidate.name === pageName) : pages[0]
  if (!page) return
  if (populateLazyFigImportRoots(graph, [page.id])) computeAllLayouts(graph, page.id)
}

function prepareForRead(graph: SceneGraph, command: string, args: unknown): void {
  if (command === 'pages' || command === 'variables') return
  if (command === 'tree') {
    populatePage(graph, requestedPageName(args))
    return
  }
  if (command === 'find' || command === 'query') {
    const pageName = requestedPageName(args)
    if (pageName) populatePage(graph, pageName)
    else if (populateAllLazyFigImportRoots(graph)) computeAllLayouts(graph)
    return
  }
  if (populateAllLazyFigImportRoots(graph)) computeAllLayouts(graph)
}

/**
 * Owns one immutable input document for the lifetime of a headless MCP process.
 * The promise itself is cached so concurrent first calls also share one decode.
 */
export class HeadlessDocumentSession {
  private graphPromise: Promise<SceneGraph> | null = null
  private figmaPromise: Promise<FigmaAPI> | null = null
  private loadStartedAt = 0
  private statusValue: HeadlessSessionStatus = { state: 'unloaded', loadCount: 0 }

  constructor(
    private filePath: string | null,
    private readonly loader: HeadlessDocumentLoader = defaultLoader
  ) {
    configureHeadlessFonts()
  }

  status(): HeadlessSessionStatus {
    return { ...this.statusValue }
  }

  async execute(command: string, args: unknown): Promise<unknown> {
    const graph = await this.graph()
    prepareForRead(graph, command, args)
    return executeRpcCommand(graph, command, args)
  }

  async rpc(body: Record<string, unknown>): Promise<unknown> {
    const command = body.command
    const args = isJsonArguments(body.args) ? body.args : {}
    if (command === 'tool') return this.executeTool(args)
    if (command === 'list_documents') return { ok: true, result: this.documentSummary() }
    if (command === 'save_file') return this.save(args.path)
    if (command === 'open_file') return this.open(args.path)
    if (command === 'new_document') return this.create(args.path)
    throw new Error(`Unsupported headless RPC command: ${String(command)}`)
  }

  private async executeTool(args: Record<string, unknown>): Promise<unknown> {
    const name = typeof args.name === 'string' ? args.name : ''
    const toolArgs = isJsonArguments(args.args) ? args.args : {}
    const def = ALL_TOOLS.find((tool) => tool.name === name)
    if (!def) throw new Error(`Unknown tool: ${name}`)

    const graph = await this.graph()
    if (populateAllLazyFigImportRoots(graph)) computeAllLayouts(graph)
    const figma = await this.figma()
    const pageId = typeof args.page_id === 'string' ? args.page_id : undefined
    if (pageId) {
      const page = graph.getNode(pageId)
      if (page?.type !== 'CANVAS') throw new Error(`Page not found: ${pageId}`)
      figma.currentPage = figma.wrapNode(pageId)
    }

    if (name === 'export_image' || name === 'export_pdf') {
      const ids = Array.isArray(toolArgs.ids)
        ? toolArgs.ids.filter((id): id is string => typeof id === 'string')
        : figma.currentPage.children.map((node) => node.id)
      await assertLocalFonts(graph, ids)
    }

    const result = await def.execute(figma, toolArgs)
    if (def.mutates) computeAllLayouts(graph, figma.currentPageId)
    return { ok: true, result }
  }

  private async figma(): Promise<FigmaAPI> {
    if (this.figmaPromise) return this.figmaPromise
    this.figmaPromise = this.graph().then((graph) => {
      const figma = new FigmaAPI(graph)
      figma.exportImage = async (nodeIds, options) => {
        await assertLocalFonts(graph, nodeIds)
        return headlessRenderNodes(graph, figma.currentPageId, nodeIds, options)
      }
      return figma
    })
    return this.figmaPromise
  }

  private documentSummary(): Array<Record<string, unknown>> {
    return [
      {
        id: 'headless',
        name: this.filePath ?? 'Untitled',
        filePath: this.filePath,
        status: this.status()
      }
    ]
  }

  private async save(pathValue: unknown): Promise<unknown> {
    const outputPath = typeof pathValue === 'string' ? pathValue : this.filePath
    if (!outputPath) throw new Error('Save path is required for an untitled document')
    const graph = await this.graph()
    const io = new IORegistry(BUILTIN_IO_FORMATS)
    const result = await io.writeDocument('fig', graph)
    if (!(result.data instanceof Uint8Array)) throw new Error('FIG writer returned non-binary data')
    await writeFile(outputPath, result.data)
    this.filePath = outputPath
    return { ok: true, result: { path: outputPath }, target: { document_id: 'headless' } }
  }

  private async open(pathValue: unknown): Promise<unknown> {
    if (typeof pathValue !== 'string' || !pathValue) throw new Error('Open path is required')
    this.reset(pathValue)
    await this.graph()
    return { ok: true, result: { path: pathValue }, target: { document_id: 'headless' } }
  }

  private async create(pathValue: unknown): Promise<unknown> {
    const { SceneGraph } = await import('@open-pencil/scene-graph')
    const graph = new SceneGraph()
    this.filePath = typeof pathValue === 'string' ? pathValue : null
    this.graphPromise = Promise.resolve(graph)
    this.figmaPromise = null
    this.statusValue = { state: 'ready', loadCount: 0, loadMs: 0, nodes: graph.nodes.size }
    return { ok: true, result: {}, target: { document_id: 'headless' } }
  }

  private reset(filePath: string): void {
    this.filePath = filePath
    this.graphPromise = null
    this.figmaPromise = null
    this.statusValue = { state: 'unloaded', loadCount: 0 }
  }

  private graph(): Promise<SceneGraph> {
    if (this.graphPromise) return this.graphPromise
    if (!this.filePath) return Promise.reject(new Error('Document has no file path'))

    this.loadStartedAt = performance.now()
    this.statusValue = { state: 'loading', loadCount: 1 }
    this.graphPromise = this.loader(this.filePath)
      .then((graph) => {
        this.statusValue = {
          state: 'ready',
          loadCount: 1,
          loadMs: Math.round(performance.now() - this.loadStartedAt),
          nodes: graph.nodes.size
        }
        return graph
      })
      .catch((error: unknown) => {
        this.statusValue = {
          state: 'failed',
          loadCount: 1,
          loadMs: Math.round(performance.now() - this.loadStartedAt),
          error: error instanceof Error ? error.message : String(error)
        }
        throw error
      })
    return this.graphPromise
  }
}
