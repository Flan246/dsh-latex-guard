#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { lintBib, type LintIssue } from './core/bib-lint.js'
import { fillBib } from './core/bib-fill.js'
import { citeAudit } from './core/cite-audit.js'
import { checkLatex, type CheckReport } from './core/check.js'
import type { Result } from './core/types.js'

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

function print<T>(r: Result<T>, asJson: boolean, render: (d: T) => string): void {
  if (!r.ok) {
    console.error(`error[${r.error.code}]: ${r.error.message}`)
    process.exitCode = 1
    return
  }
  console.log(asJson ? JSON.stringify(r.data, null, 2) : render(r.data))
}

const program = new Command()
program.name('dsh-latex-guard').description('LaTeX compile check and BibTeX lint/fill/audit tools')
  .option('--json', 'print machine-readable JSON', false)

program.command('check').argument('<dir>').argument('<entry>')
  .action(async (dir: string, entry: string) => {
    print(await checkLatex(dir, entry), program.opts().json, formatReport)
  })

program.command('bib-lint').argument('<bib>').option('--write', 'write fixed bib back', false)
  .action(async (bib: string, o: { write: boolean }) => {
    const text = await readFile(bib, 'utf8')
    const { issues, fixed } = lintBib(text)
    if (o.write) await writeFile(bib, fixed)
    print({ ok: true as const, data: { issues, fixed: o.write ? '(written back)' : fixed } },
      program.opts().json, (d) => formatIssues(d.issues))
  })

program.command('bib-fill').argument('<bib>').option('--write', 'write fixed bib back', false)
  .action(async (bib: string, o: { write: boolean }) => {
    const text = await readFile(bib, 'utf8')
    const r = await fillBib(text)
    if (r.ok && o.write) await writeFile(bib, r.data.fixed)
    print(r, program.opts().json,
      (d) => `filled: ${d.filled.join(', ') || '-'}\nmissing: ${d.missing.join(', ') || '-'}`)
  })

program.command('cite-audit').argument('<bib>').argument('<tex...>')
  .action(async (bib: string, texs: string[]) => {
    const bibText = await readFile(bib, 'utf8')
    const sources = await Promise.all(texs.map((t) => readFile(t, 'utf8')))
    print({ ok: true as const, data: citeAudit(sources, bibText) }, program.opts().json,
      (d) => `missing in bib: ${d.missingInBib.join(', ') || '-'}\nuncited entries: ${d.uncited.join(', ') || '-'}`)
  })

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  program.parseAsync()
}
