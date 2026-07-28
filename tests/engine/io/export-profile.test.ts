import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const profileModuleUrl = pathToFileURL(
  resolve(import.meta.dir, '../../../packages/core/src/io/export-profile.ts')
).href

async function runProfileSubprocess(enabled: boolean) {
  const child = Bun.spawn(
    [
      'bun',
      '-e',
      `const { finishExportProfile, startExportProfile } = await import(${JSON.stringify(profileModuleUrl)})
const span = startExportProfile('test_phase', { nodes: 3 })
finishExportProfile(span, { bytes: 12 })`
    ],
    {
      env: { ...process.env, OPENPENCIL_EXPORT_PROFILE: enabled ? '1' : '0' },
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ])
  return { stdout, stderr, exitCode }
}

describe('export profiling', () => {
  test('is silent unless explicitly enabled', async () => {
    const result = await runProfileSubprocess(false)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  test('writes phase start and end events to stderr', async () => {
    const result = await runProfileSubprocess(true)
    const events = result.stderr
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: 'phase_start', phase: 'test_phase', nodes: 3 })
    expect(events[1]).toMatchObject({
      event: 'phase_end',
      phase: 'test_phase',
      nodes: 3,
      bytes: 12
    })
    expect(events[0].rss_mb).toBeGreaterThan(0)
    expect(events[1].rss_mb).toBeGreaterThan(0)
    expect(events[1].ms).toBeGreaterThanOrEqual(0)
  })
})
