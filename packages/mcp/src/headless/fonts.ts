import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import { DEFAULT_FONT_FAMILY } from '@open-pencil/core/constants'
import { fontManager, weightToStyle } from '@open-pencil/core/text'
import type { SceneGraph } from '@open-pencil/scene-graph'

const execFileAsync = promisify(execFile)

function fontconfigFamilyMatches(requested: string, resolved: string): boolean {
  const expected = requested.trim().toLocaleLowerCase()
  return resolved
    .split(',')
    .map((family) => family.trim().toLocaleLowerCase())
    .includes(expected)
}

async function loadExactLinuxFont(family: string, style: string): Promise<ArrayBuffer | null> {
  try {
    const pattern = style ? `${family}:style=${style}` : family
    const { stdout } = await execFileAsync('fc-match', ['--format=%{family}\t%{file}', pattern], {
      encoding: 'utf8',
      timeout: 5_000
    })
    const separator = stdout.indexOf('\t')
    if (separator === -1) return null
    const resolvedFamily = stdout.slice(0, separator)
    const path = stdout.slice(separator + 1).trim()
    if (!path || !fontconfigFamilyMatches(family, resolvedFamily)) return null
    const data = await readFile(path)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  } catch {
    return null
  }
}

export function configureHeadlessFonts(): void {
  fontManager.setOnlineFontProviders({
    google: false,
    fontsource: false,
    bunny: false,
    fontshare: false
  })
  if (process.platform === 'linux') fontManager.setHostFontLoader(loadExactLinuxFont)
}

function requiredLocalFontKeys(graph: SceneGraph, nodeIds: string[]): Array<[string, string]> {
  const keys = new Set<string>()
  const visited = new Set<string>()
  const collect = (nodeId: string) => {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const node = graph.getNode(nodeId)
    if (!node) return
    if (node.type === 'TEXT' && node.text && !node.figmaDerivedTextGlyphs?.length) {
      const family = node.fontFamily || DEFAULT_FONT_FAMILY
      keys.add(`${family}\0${weightToStyle(node.fontWeight || 400, node.italic)}`)
      for (const run of node.styleRuns) {
        const runFamily = run.style.fontFamily ?? family
        const weight = run.style.fontWeight ?? node.fontWeight
        const italic = run.style.italic ?? node.italic
        keys.add(`${runFamily}\0${weightToStyle(weight, italic)}`)
      }
    }
    for (const childId of node.childIds) collect(childId)
  }
  for (const nodeId of nodeIds) collect(nodeId)
  return Array.from(keys, (key) => key.split('\0') as [string, string])
}

export async function assertLocalFonts(graph: SceneGraph, nodeIds: string[]): Promise<void> {
  const fontKeys = requiredLocalFontKeys(graph, nodeIds)
  const results = await Promise.all(
    fontKeys.map(([family, style]) => fontManager.loadFont(family, style))
  )
  const missing = fontKeys
    .filter((_, index) => results[index] === null)
    .map(([family, style]) => `${family} (${style})`)
  if (missing.length > 0) throw new Error(`Local font not found: ${missing.join(', ')}`)
}
