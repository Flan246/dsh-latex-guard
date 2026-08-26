import { describe, expect, it, vi } from 'vitest'
import { checkLatex, parseLog } from '../src/core/check.js'

const LOG = `./main.tex:12: Undefined control sequence.
! Undefined control sequence.
l.12 \\badcmd
LaTeX Warning: Reference 'sec:x' on page 1 undefined on input line 20.
LaTeX Warning: Citation 'ghost2023' on page 2 undefined on input line 33.
`

describe('parseLog', () => {
  it('extracts errors, warnings and undefined citations', () => {
    const r = parseLog(LOG)
    expect(r.errors[0]?.message).toContain('Undefined control sequence')
    expect(r.errors[0]?.line).toBe(12)
    expect(r.warnings).toHaveLength(2)
    expect(r.missingCitations).toEqual(['ghost2023'])
  })
})

describe('checkLatex', () => {
  it('skips gracefully when latexmk is absent', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => false,
      readFile: vi.fn(async (p: string) =>
        p.endsWith('main.tex') ? '\\cite{a}' : '@article{a,\n author={A}, title={T}, journal={J}, year={2020},\n}'),
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.status).toBe('skipped')
    expect(r.data.notice).toContain('latexmk')
  })

  it('reports failed status when runner exits non-zero', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 1, log: LOG }),
      readFile: vi.fn(async () => 'x'),
    })
    expect(r.ok && r.data.status).toBe('failed')
    expect(r.ok && r.data.errors.length).toBeGreaterThan(0)
  })
})
