export type ExportProfileField = boolean | number | string
export type ExportProfileFields = Readonly<Record<string, ExportProfileField>>

export interface ExportProfileSpan {
  phase: string
  startedAt: number
  fields: ExportProfileFields
}

function profileEnabled(): boolean {
  return typeof process !== 'undefined' && process.env.OPENPENCIL_EXPORT_PROFILE === '1'
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function residentMemoryMb(): number | undefined {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return undefined
  return Math.round(process.memoryUsage().rss / 1024 / 1024)
}

function writeProfileEvent(event: Record<string, ExportProfileField | undefined>): void {
  if (typeof process === 'undefined' || typeof process.stderr?.write !== 'function') return
  process.stderr.write(`${JSON.stringify(event)}\n`)
}

export function startExportProfile(
  phase: string,
  fields: ExportProfileFields = {}
): ExportProfileSpan | null {
  if (!profileEnabled()) return null
  const span = { phase, startedAt: now(), fields }
  writeProfileEvent({ ...fields, event: 'phase_start', phase, rss_mb: residentMemoryMb() })
  return span
}

export function finishExportProfile(
  span: ExportProfileSpan | null,
  fields: ExportProfileFields = {}
): void {
  if (!span) return
  writeProfileEvent({
    ...span.fields,
    ...fields,
    event: 'phase_end',
    phase: span.phase,
    ms: Math.round(now() - span.startedAt),
    rss_mb: residentMemoryMb()
  })
}
