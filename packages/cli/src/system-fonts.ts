import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

import { fontManager } from '@open-pencil/core/text'

const execFileAsync = promisify(execFile)

async function loadLinuxFont(family: string, style: string): Promise<ArrayBuffer | null> {
  try {
    const pattern = style ? `${family}:style=${style}` : family
    const { stdout } = await execFileAsync('fc-match', ['--format=%{file}', pattern], {
      encoding: 'utf8',
      timeout: 5_000
    })
    const path = stdout.trim()
    if (!path) return null
    const data = await readFile(path)
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  } catch {
    return null
  }
}

export function configureOfflineFonts(): void {
  fontManager.setOnlineFontProviders({
    google: false,
    fontsource: false,
    bunny: false,
    fontshare: false
  })
  if (process.platform === 'linux') fontManager.setHostFontLoader(loadLinuxFont)
}
