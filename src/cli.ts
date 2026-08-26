#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { lintBib } from './core/bib-lint.js'
import { fillBib } from './core/bib-fill.js'
import { citeAudit } from './core/cite-audit.js'
import { checkLatex } from './core/check.js'
import { formatIssues, formatReport } from './core/format.js'
import { err, type Result } from './core/types.js'

export { formatIssues, formatReport }

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
    let text: string
    try {
      text = await readFile(bib, 'utf8')
    } catch {
      print(err('NOT_FOUND', `file not found: ${bib}`), program.opts().json, () => '')
      return
    }
    const { issues, fixed } = lintBib(text)
    if (o.write) await writeFile(bib, fixed)
    print({ ok: true as const, data: { issues, fixed: o.write ? '(written back)' : fixed } },
      program.opts().json, (d) => formatIssues(d.issues))
  })

program.command('bib-fill').argument('<bib>').option('--write', 'write fixed bib back', false)
  .action(async (bib: string, o: { write: boolean }) => {
    let text: string
    try {
      text = await readFile(bib, 'utf8')
    } catch {
      print(err('NOT_FOUND', `file not found: ${bib}`), program.opts().json, () => '')
      return
    }
    const r = await fillBib(text)
    if (r.ok && o.write) await writeFile(bib, r.data.fixed)
    print(r, program.opts().json,
      (d) => `filled: ${d.filled.join(', ') || '-'}\nmissing: ${d.missing.join(', ') || '-'}`)
  })

program.command('cite-audit').argument('<bib>').argument('<tex...>')
  .action(async (bib: string, texs: string[]) => {
    let bibText: string
    let sources: string[]
    try {
      bibText = await readFile(bib, 'utf8')
      sources = await Promise.all(texs.map((t) => readFile(t, 'utf8')))
    } catch {
      print(err('NOT_FOUND', `file not found: ${bib} or one of the tex sources`),
        program.opts().json, () => '')
      return
    }
    print({ ok: true as const, data: citeAudit(sources, bibText) }, program.opts().json,
      (d) => `missing in bib: ${d.missingInBib.join(', ') || '-'}\nuncited entries: ${d.uncited.join(', ') || '-'}`)
  })

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  program.parseAsync()
}
