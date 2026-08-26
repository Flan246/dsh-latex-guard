import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formatIssues, formatReport, guardedWriteBib, printCheck } from '../src/cli.js'

describe('formatIssues', () => {
  it('lists issues with key and detail', () => {
    const out = formatIssues([{ kind: 'missing-field', key: 'a2020', detail: 'missing: year' }])
    expect(out).toContain('a2020')
    expect(out).toContain('missing: year')
  })

  it('renders clean state', () => {
    expect(formatIssues([])).toBe('No issues found.')
  })
})

describe('formatReport', () => {
  it('shows status and counts', () => {
    const out = formatReport({
      status: 'failed', errors: [{ line: 12, message: 'boom', file: null }],
      warnings: [], missingCitations: ['ghost'], notice: null,
    })
    expect(out).toContain('failed')
    expect(out).toContain('boom')
    expect(out).toContain('ghost')
  })
})

describe('printCheck exit code', () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it('sets exit code 1 when the compile check failed', () => {
    printCheck({
      ok: true,
      data: {
        status: 'failed', errors: [{ line: 3, message: 'boom', file: null }],
        warnings: [], missingCitations: [], notice: null,
      },
    }, true)
    expect(process.exitCode).toBe(1)
  })

  it('keeps exit code 0 for passed and skipped (graceful degradation)', () => {
    const base = { errors: [], warnings: [], missingCitations: [], notice: null }
    printCheck({ ok: true, data: { ...base, status: 'passed' } }, true)
    expect(process.exitCode).toBe(undefined)
    printCheck({ ok: true, data: { ...base, status: 'skipped', notice: 'latexmk not found' } }, true)
    expect(process.exitCode).toBe(undefined)
  })
})

describe('guardedWriteBib', () => {
  const TRUNCATED = '@article{a,\n  author = {A},\n  year = {2020},\n}\n\n@book{b,\n  title = {Boo'

  it('refuses to write an incompletely parsed bib and leaves the file untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lg-cli-'))
    try {
      const p = join(dir, 'refs.bib')
      await writeFile(p, TRUNCATED, 'utf8')
      const r = await guardedWriteBib(p, TRUNCATED, '@article{a,\n  author = {A}\n}\n')
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error.code).toBe('PARSE_INCOMPLETE')
      expect(await readFile(p, 'utf8')).toBe(TRUNCATED)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes back a fully parsed bib', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lg-cli-'))
    try {
      const original = '@article{a,\n  author = {A},\n  year = {2020},\n}\n'
      const fixed = '@article{a,\n  author = {A},\n  year = {2020}\n}\n'
      const p = join(dir, 'refs.bib')
      await writeFile(p, original, 'utf8')
      const r = await guardedWriteBib(p, original, fixed)
      expect(r.ok).toBe(true)
      expect(await readFile(p, 'utf8')).toBe(fixed)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
