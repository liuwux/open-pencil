import { readFile } from 'node:fs/promises'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { populateAllLazyFigImportRoots, populateLazyFigImportRoots } from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { executeRpcCommand } from '@open-pencil/core/rpc'
import type { SceneGraph } from '@open-pencil/scene-graph'

export type HeadlessDocumentLoader = (filePath: string) => Promise<SceneGraph>

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
  private loadStartedAt = 0
  private statusValue: HeadlessSessionStatus = { state: 'unloaded', loadCount: 0 }

  constructor(
    private readonly filePath: string,
    private readonly loader: HeadlessDocumentLoader = defaultLoader
  ) {}

  status(): HeadlessSessionStatus {
    return { ...this.statusValue }
  }

  async execute(command: string, args: unknown): Promise<unknown> {
    const graph = await this.graph()
    prepareForRead(graph, command, args)
    return executeRpcCommand(graph, command, args)
  }

  private graph(): Promise<SceneGraph> {
    if (this.graphPromise) return this.graphPromise

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
