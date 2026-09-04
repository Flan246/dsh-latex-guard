#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { lintBib } from './core/bib-lint.js'
import { fillBib } from './core/bib-fill.js'
import { citeAudit } from './core/cite-audit.js'
import { checkLatex, type CheckReport } from './core/check.js'
import { isFullyParsed } from './core/bib-parse.js'
import { formatFill, formatIssues, formatReport } from './core/format.js'
import { err, ok, type Result } from './core/types.js'

export { formatFill, formatIssues, formatReport }

function print<T>(r: Result<T>, asJson: boolean, render: (d: T) => string): void {
  if (!r.ok) {
    console.error(`error[${r.error.code}]: ${r.error.message}`)
    process.exitCode = 1
    return
  }
  console.log(asJson ? JSON.stringify(r.data, null, 2) : render(r.data))
}

// A failed compile is a business error: exit 1 per the README contract.
// `skipped` (latexmk absent) stays exit 0 — graceful degradation is not an error.
export function printCheck(r: Result<CheckReport>, asJson: boolean): void {
  print(r, asJson, formatReport)
  if (r.ok && r.data.status === 'failed') process.exitCode = 1
}

// Refuse to write back when the bib could not be fully parsed (see
// isFullyParsed) — otherwise the reformatted prefix would silently drop
// everything after the first unclosed entry.
export async function guardedWriteBib(path: string, original: string, fixed: string): Promise<Result<null>> {
  if (!isFullyParsed(original)) {
    return err('PARSE_INCOMPLETE',
      `refusing to write ${path}: the bib is not fully parseable (an entry is probably missing its closing brace); writing back would drop content. Fix the entry first.`)
  }
  await writeFile(path, fixed)
  return ok(null)
}

const program = new Command()
program.name('dsh-latex-guard').description('LaTeX compile check and BibTeX lint/fill/audit tools')
  .option('--json', 'print machine-readable JSON', false)

const ENGINES = ['auto', 'pdflatex', 'xelatex', 'lualatex'] as const

program.command('check').argument('<dir>').argument('<entry>')
  .option('--engine <name>', 'latexmk engine: auto | pdflatex | xelatex | lualatex (default auto)', 'auto')
  .action(async (dir: string, entry: string, o: { engine: string }) => {
    if (!(ENGINES as readonly string[]).includes(o.engine)) {
      console.error(`error[INVALID_ENGINE]: --engine must be one of ${ENGINES.join(', ')} (got "${o.engine}")`)
      process.exitCode = 2
      return
    }
    printCheck(await checkLatex(dir, entry, { engine: o.engine as (typeof ENGINES)[number] }),
      program.opts().json)
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
    if (o.write) {
      const w = await guardedWriteBib(bib, text, fixed)
      if (!w.ok) { print(w, program.opts().json, () => ''); return }
    }
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
    if (r.ok && o.write) {
      const w = await guardedWriteBib(bib, text, r.data.fixed)
      if (!w.ok) { print(w, program.opts().json, () => ''); return }
    }
    print(r, program.opts().json, formatFill)
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
