#!/usr/bin/env node
import { resolve } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { HeadlessDocumentSession } from '#mcp/headless/session'
import { fail, ok } from '#mcp/result'
import { MCP_VERSION } from '#mcp/server'

function fileArgument(argv: string[]): string | null {
  const fileFlag = argv.indexOf('--file')
  if (fileFlag !== -1) return argv[fileFlag + 1] ?? null
  return argv.find((arg) => !arg.startsWith('-')) ?? process.env.OPENPENCIL_FIG_FILE ?? null
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    `openpencil-mcp-headless <file.fig>\n\n` +
      `Start a read-only MCP server that decodes one design file once and reuses its SceneGraph.\n\n` +
      `Options:\n` +
      `  --file <path>  Input .fig or .pen file\n` +
      `  --help, -h     Show this help message\n\n` +
      `Environment variables:\n` +
      `  OPENPENCIL_FIG_FILE  Input file when no positional path is supplied\n`
  )
  process.exit(0)
}

const input = fileArgument(process.argv.slice(2))
if (!input) {
  process.stderr.write('Error: pass a .fig/.pen path or set OPENPENCIL_FIG_FILE\n')
  process.exit(1)
}

const session = new HeadlessDocumentSession(resolve(input))
const server = new McpServer({ name: 'open-pencil-headless-readonly', version: MCP_VERSION })
const register = server.registerTool.bind(server) as (...args: unknown[]) => void

function registerReadTool(
  name: string,
  description: string,
  inputSchema: z.ZodObject,
  command = name
) {
  register(name, { description, inputSchema }, async (args: unknown) => {
    try {
      return ok(await session.execute(command, args), name)
    } catch (error) {
      return fail(error)
    }
  })
}

register(
  'session_status',
  {
    description: 'Show whether the fixed input document is unloaded, loading, ready, or failed.',
    inputSchema: z.object({})
  },
  async () => ok(session.status(), 'session_status')
)

registerReadTool('info', 'Summarize pages, node types, fonts, and node counts.', z.object({}))
registerReadTool('pages', 'List document pages and node counts.', z.object({}))
registerReadTool(
  'tree',
  'Read a page node tree. Use a small depth for large documents.',
  z.object({
    page: z.string().optional(),
    depth: z.number().int().min(0).optional()
  })
)
registerReadTool(
  'find',
  'Find nodes by partial name and/or node type.',
  z.object({
    name: z.string().optional(),
    type: z.string().optional(),
    page: z.string().optional(),
    limit: z.number().int().positive().max(10_000).optional()
  })
)
registerReadTool(
  'query',
  'Query nodes with an XPath selector.',
  z.object({
    selector: z.string().min(1),
    page: z.string().optional(),
    limit: z.number().int().positive().max(10_000).optional()
  })
)
registerReadTool(
  'node',
  'Read the properties of one node by ID.',
  z.object({ id: z.string().min(1) })
)
registerReadTool(
  'variables',
  'List variable collections and resolved values.',
  z.object({ collection: z.string().optional(), type: z.string().optional() })
)

const transport = new StdioServerTransport()
server.connect(transport).catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
