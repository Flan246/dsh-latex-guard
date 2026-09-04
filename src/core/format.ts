import type { LintIssue } from './bib-lint.js'
import type { CheckReport } from './check.js'

export interface FillResult {
  fixed: string
  filled: string[]
  missing: string[]
  // Present since 0.1.2; older callers may omit it, so keep it optional here.
  failed?: string[]
}

export function formatFill(d: FillResult): string {
  const lines = [`filled: ${d.filled.join(', ') || '-'}`, `missing: ${d.missing.join(', ') || '-'}`]
  if (d.failed?.length) lines.push(`failed: ${d.failed.join(', ')}`)
  return lines.join('\n')
}

export function formatIssues(issues: LintIssue[]): string {
  if (issues.length === 0) return 'No issues found.'
  return issues.map((i) => `[${i.kind}] ${i.key}: ${i.detail}`).join('\n')
}

export function formatReport(r: CheckReport): string {
  const lines = [`status: ${r.status}`, `engine: ${r.engine}`]
  if (r.notice) lines.push(`notice: ${r.notice}`)
  for (const e of r.errors) lines.push(`ERROR${e.line ? ` (line ${e.line})` : ''}: ${e.message}`)
  for (const w of r.warnings) lines.push(`warn: ${w.message}`)
  if (r.missingCitations.length) lines.push(`missing citations: ${r.missingCitations.join(', ')}`)
  if (r.logTail) lines.push(`--- log tail ---\n${r.logTail}`)
  return lines.join('\n')
}
