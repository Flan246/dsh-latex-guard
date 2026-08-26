import type { LintIssue } from './bib-lint.js'
import type { CheckReport } from './check.js'

export function formatIssues(issues: LintIssue[]): string {
  if (issues.length === 0) return 'No issues found.'
  return issues.map((i) => `[${i.kind}] ${i.key}: ${i.detail}`).join('\n')
}

export function formatReport(r: CheckReport): string {
  const lines = [`status: ${r.status}`]
  if (r.notice) lines.push(`notice: ${r.notice}`)
  for (const e of r.errors) lines.push(`ERROR${e.line ? ` (line ${e.line})` : ''}: ${e.message}`)
  for (const w of r.warnings) lines.push(`warn: ${w.message}`)
  if (r.missingCitations.length) lines.push(`missing citations: ${r.missingCitations.join(', ')}`)
  return lines.join('\n')
}
