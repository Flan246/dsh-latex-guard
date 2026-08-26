import { mkdtemp, readFile, rm, writeFile as fsWriteFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/plugin.js'

function captureTools() {
  const registered: any[] = []
  const ctx = { tools: { register: (t: any) => registered.push(t) } }
  plugin.apply(ctx as any)
  return Object.fromEntries(registered.map((t) => [t.name, t]))
}

function renderText(tool: any, args: any, value: any): string {
  const parts = tool.output.render(args, value)
  return parts.map((p: any) => p.text).join('\n')
}

describe('plugin', () => {
  it('exports cordis plugin contract', () => {
    expect(plugin.name).toBe('dsh-latex-guard')
    expect(plugin.inject).toEqual(['tools'])
    expect(typeof plugin.apply).toBe('function')
  })

  it('registers 4 tools on apply', () => {
    const registered: any[] = []
    const ctx = { tools: { register: (t: any) => registered.push(t) } }
    plugin.apply(ctx as any)
    expect(registered.map((t) => t.name).sort()).toEqual(
      ['bib_fill', 'bib_lint', 'cite_audit', 'latex_check'])
  })
})

describe('plugin execute error mapping', () => {
  const tools = captureTools()

  it('bib_lint maps missing file to NOT_FOUND error', async () => {
    const r = await tools.bib_lint.execute({ path: '/no/such/file.bib' })
    expect(r.error.code).toBe('NOT_FOUND')
  })

  it('bib_fill maps missing file to NOT_FOUND error', async () => {
    const r = await tools.bib_fill.execute({ path: '/no/such/file.bib' })
    expect(r.error.code).toBe('NOT_FOUND')
  })

  it('cite_audit maps missing bib to NOT_FOUND error', async () => {
    const r = await tools.cite_audit.execute({ bib: '/no/such/file.bib', tex: [] })
    expect(r.error.code).toBe('NOT_FOUND')
  })

  it('cite_audit maps missing tex to NOT_FOUND error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lg-plugin-'))
    try {
      const bib = join(dir, 'refs.bib')
      await fsWriteFile(bib, '@article{a, title={T}}', 'utf8')
      const r = await tools.cite_audit.execute({ bib, tex: [join(dir, 'nope.tex')] })
      expect(r.error.code).toBe('NOT_FOUND')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('plugin write error handling', () => {
  const tools = captureTools()
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lg-plugin-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function makeReadOnly(name: string, content: string): Promise<string> {
    const p = join(dir, name)
    await fsWriteFile(p, content, 'utf8')
    await chmod(p, 0o444)
    return p
  }

  it('bib_lint write failure returns WRITE_FAILED instead of throwing', async () => {
    const p = await makeReadOnly('refs.bib', '@article{A, title={T}, year={2020}}\n')
    try {
      const r = await tools.bib_lint.execute({ path: p, write: true })
      expect(r.error.code).toBe('WRITE_FAILED')
    } finally {
      await chmod(p, 0o644)
    }
  })

  it('bib_fill write failure returns WRITE_FAILED instead of throwing', async () => {
    // Entry without doi/title never hits the network, so fillBib resolves offline.
    const p = await makeReadOnly('refs.bib', '@misc{A, note={x}}\n')
    try {
      const r = await tools.bib_fill.execute({ path: p, write: true })
      expect(r.error.code).toBe('WRITE_FAILED')
    } finally {
      await chmod(p, 0o644)
    }
  })

  it('bib_lint refuses to write an incompletely parsed bib', async () => {
    const truncated = '@article{a,\n  author = {A},\n  year = {2020},\n}\n\n@book{b,\n  title = {Boo'
    const p = join(dir, 'refs.bib')
    await fsWriteFile(p, truncated, 'utf8')
    const r = await tools.bib_lint.execute({ path: p, write: true })
    expect(r.error.code).toBe('PARSE_INCOMPLETE')
    expect(await readFile(p, 'utf8')).toBe(truncated)
  })

  it('bib_fill refuses to write an incompletely parsed bib', async () => {
    const truncated = '@misc{a, note={x}}\n\n@book{b,\n  title = {Boo'
    const p = join(dir, 'refs.bib')
    await fsWriteFile(p, truncated, 'utf8')
    const r = await tools.bib_fill.execute({ path: p, write: true })
    expect(r.error.code).toBe('PARSE_INCOMPLETE')
    expect(await readFile(p, 'utf8')).toBe(truncated)
  })
})

describe('plugin render branches', () => {
  const tools = captureTools()
  const err = { code: 'X', message: 'boom' }

  it('latex_check renders error and success', () => {
    expect(renderText(tools.latex_check, {}, { error: err })).toContain('Check failed: boom')
    const ok = renderText(tools.latex_check, {}, {
      status: 'passed', errors: [], warnings: [], missingCitations: [],
    })
    expect(ok).toContain('status: passed')
  })

  it('bib_lint renders error and success', () => {
    expect(renderText(tools.bib_lint, {}, { error: err })).toContain('Lint failed: boom')
    const ok = renderText(tools.bib_lint, {}, {
      issues: [{ kind: 'duplicate-key', key: 'a', detail: 'dup' }], fixed: '',
    })
    expect(ok).toContain('[duplicate-key] a: dup')
  })

  it('bib_fill renders error and success', () => {
    expect(renderText(tools.bib_fill, {}, { error: err })).toContain('Fill failed: boom')
    const ok = renderText(tools.bib_fill, {}, { fixed: 'x', filled: ['a'], missing: [] })
    expect(ok).toContain('filled: a')
  })

  it('cite_audit renders error and success', () => {
    expect(renderText(tools.cite_audit, {}, { error: err })).toContain('Audit failed: boom')
    const ok = renderText(tools.cite_audit, {}, { missingInBib: ['k1'], uncited: [] })
    expect(ok).toContain('missing in bib: k1')
  })
})
