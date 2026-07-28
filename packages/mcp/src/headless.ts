#!/usr/bin/env node
import { dirname, resolve } from 'node:path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { HeadlessDocumentSession } from '#mcp/headless/session'
import { ok } from '#mcp/result'
import { MCP_VERSION, registerTools } from '#mcp/server'

function fileArgument(argv: string[]): string | null {
  const fileFlag = argv.indexOf('--file')
  if (fileFlag !== -1) return argv[fileFlag + 1] ?? null
  return argv.find((arg) => !arg.startsWith('-')) ?? process.env.OPENPENCIL_FIG_FILE ?? null
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    `openpencil-mcp-headless <file.fig>\n\n` +
      `Start a full MCP server that decodes one design file once and reuses its SceneGraph.\n\n` +
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
const server = new McpServer({ name: 'open-pencil-headless', version: MCP_VERSION })
const mcpRoot = process.env.OPENPENCIL_MCP_ROOT?.trim() || dirname(resolve(input))
registerTools(server, { enableEval: true, mcpRoot, sendRpc: session.rpc.bind(session) })
const register = server.registerTool.bind(server) as (...args: unknown[]) => void

register(
  'session_status',
  {
    description: 'Show whether the fixed input document is unloaded, loading, ready, or failed.',
    inputSchema: z.object({})
  },
  async () => ok(session.status(), 'session_status')
)

const transport = new StdioServerTransport()
server.connect(transport).catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
