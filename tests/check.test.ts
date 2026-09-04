import { describe, expect, it, vi } from 'vitest'
import { checkLatex, defaultRun, parseLog } from '../src/core/check.js'
import { formatReport } from '../src/core/format.js'

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

describe('engine detection', () => {
  const runArgs = async (tex: string, engine?: 'auto' | 'pdflatex' | 'xelatex' | 'lualatex') => {
    const run = vi.fn(async (_cmd: string, _args: string[], _cwd: string) => ({ code: 0, log: '' }))
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run,
      readFile: async () => tex,
      ...(engine ? { engine } : {}),
    })
    expect(r.ok).toBe(true)
    return run.mock.calls[0]![1]
  }

  it('detects xelatex for \\RequireXeTeX', async () => {
    expect(await runArgs('\\RequireXeTeX\n\\documentclass{article}')).toContain('-xelatex')
  })

  it('detects xelatex for xeCJK', async () => {
    expect(await runArgs('\\usepackage{xeCJK}')).toContain('-xelatex')
  })

  it('detects xelatex for ctex class/package', async () => {
    expect(await runArgs('\\documentclass{ctexart}')).toContain('-xelatex')
  })

  it('detects lualatex for \\RequireLuaTeX', async () => {
    expect(await runArgs('\\RequireLuaTeX')).toContain('-lualatex')
  })

  it('falls back to pdflatex for plain tex', async () => {
    const args = await runArgs('\\documentclass{article}')
    expect(args).toContain('-pdf')
    expect(args).not.toContain('-xelatex')
  })

  it('detects xelatex for CJK body text without markers', async () => {
    const args = await runArgs('\\documentclass{article}\n\\begin{document}\n你好，世界\n\\end{document}')
    expect(args).toContain('-xelatex')
  })

  it('ignores CJK characters that only appear in comment lines', async () => {
    const args = await runArgs('% 这是中文注释\n  % 缩进的注释\n\\documentclass{article}')
    expect(args).toContain('-pdf')
    expect(args).not.toContain('-xelatex')
  })

  it('prefers the magic comment over the CJK body heuristic', async () => {
    expect(await runArgs('% !TeX program = lualatex\n中文正文')).toContain('-lualatex')
  })

  it('honors the % !TeX program magic comment', async () => {
    expect(await runArgs('% !TeX program = xelatex\n\\documentclass{article}')).toContain('-xelatex')
  })

  it('detects xelatex from a local document class file', async () => {
    const run = vi.fn(async (_cmd: string, _args: string[], _cwd: string) => ({ code: 0, log: '' }))
    await checkLatex('/p', 'paper.tex', {
      which: async () => true,
      run,
      readFile: async (p: string) =>
        p.endsWith('.cls') ? '\\RequireXeTeX\n\\RequirePackage{ctex}' : '\\documentclass{cumcmthesis}',
    })
    expect(run.mock.calls[0]![1]).toContain('-xelatex')
  })

  it('falls back to pdflatex when the local class file is unreadable', async () => {
    const run = vi.fn(async (_cmd: string, _args: string[], _cwd: string) => ({ code: 0, log: '' }))
    const r = await checkLatex('/p', 'paper.tex', {
      which: async () => true,
      run,
      readFile: async (p: string) => {
        if (p.endsWith('.cls')) throw new Error('ENOENT')
        return '\\documentclass{cumcmthesis}'
      },
    })
    expect(r.ok).toBe(true)
    expect(run.mock.calls[0]![1]).toContain('-pdf')
  })

  it('explicit engine overrides detection', async () => {
    expect(await runArgs('\\RequireXeTeX', 'pdflatex')).toContain('-pdf')
    expect(await runArgs('\\documentclass{article}', 'xelatex')).toContain('-xelatex')
  })

  it('reports the engine actually used', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 0, log: '' }),
      readFile: async () => '\\RequireXeTeX',
    })
    expect(r.ok && r.data.engine).toBe('xelatex')
  })
})

describe('parseLog star blocks', () => {
  it('captures XeTeX required blocks as an error', () => {
    const log = '*************************************************\n' +
      '* XeTeX is required to compile this document.\n' +
      '* Sorry!\n' +
      '*************************************************\n'
    const r = parseLog(log)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.message).toContain('XeTeX is required')
    expect(r.errors[0]!.line).toBeNull()
    expect(r.errors[0]!.file).toBeNull()
  })

  it('ignores harmless asterisk decorations', () => {
    const r = parseLog('* just a note\n* another note\n')
    expect(r.errors).toHaveLength(0)
  })

  it('matches blocks indented by latexmk with CRLF endings', () => {
    const log = ' ********************************************\r\n' +
      ' * XeTeX is required to compile this document.\r\n' +
      ' * Sorry!\r\n' +
      ' ********************************************\r\n'
    const r = parseLog(log)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.message).toContain('XeTeX is required')
  })
})

describe('citation warning denoise', () => {
  const WARN_LOG = "LaTeX Warning: Citation 'ghost2023' on page 1 undefined on input line 10.\n"

  it('drops intermediate-pass warnings for keys confirmed present in the bib', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 0, log: WARN_LOG }),
      readFile: async (p: string) =>
        p.endsWith('.bib')
          ? '@article{ghost2023,\n  author={A}, title={T}, journal={J}, year={2020},\n}'
          : '\\cite{ghost2023}',
    })
    expect(r.ok && r.data.status).toBe('passed')
    expect(r.ok && r.data.missingCitations).toEqual([])
  })

  it('keeps citations that are truly missing from the bib', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 0, log: WARN_LOG }),
      readFile: async (p: string) =>
        p.endsWith('.bib')
          ? '@article{other2020,\n  author={A}, title={T}, journal={J}, year={2020},\n}'
          : '\\cite{ghost2023}',
    })
    expect(r.ok && r.data.status).toBe('passed')
    expect(r.ok && r.data.missingCitations).toEqual(['ghost2023'])
  })

  it('keeps the original list when the bib is unreadable', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 0, log: WARN_LOG }),
      readFile: async (p: string) => {
        if (p.endsWith('.bib')) throw new Error('ENOENT')
        return '\\cite{ghost2023}'
      },
    })
    expect(r.ok && r.data.status).toBe('passed')
    expect(r.ok && r.data.missingCitations).toEqual(['ghost2023'])
  })

  it('does not denoise a failed report', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 1, log: WARN_LOG }),
      readFile: async (p: string) =>
        p.endsWith('.bib')
          ? '@article{ghost2023,\n  author={A}, title={T}, journal={J}, year={2020},\n}'
          : '\\cite{ghost2023}',
    })
    expect(r.ok && r.data.status).toBe('failed')
    expect(r.ok && r.data.missingCitations).toEqual(['ghost2023'])
  })
})

describe('logTail', () => {
  it('fills logTail when failed with no parseable errors', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 12, log: 'compiling...\nweird failure without bang lines\n' }),
      readFile: async () => 'x',
    })
    expect(r.ok && r.data.status).toBe('failed')
    expect(r.ok && r.data.logTail).toContain('weird failure')
  })

  it('keeps logTail null on passed', async () => {
    const r = await checkLatex('/p', 'main.tex', {
      which: async () => true,
      run: async () => ({ code: 0, log: 'all good\n' }),
      readFile: async () => 'x',
    })
    expect(r.ok && r.data.status).toBe('passed')
    expect(r.ok && r.data.logTail).toBeNull()
  })
})

describe('formatReport engine and logTail', () => {
  const base = {
    errors: [], warnings: [], missingCitations: [], notice: null,
    engine: 'xelatex' as const, logTail: null,
  }

  it('shows the engine line after the status', () => {
    const out = formatReport({ ...base, status: 'passed' })
    expect(out.split('\n')[1]).toBe('engine: xelatex')
  })

  it('appends the log tail section when present', () => {
    const out = formatReport({ ...base, status: 'failed', logTail: 'tail content' })
    expect(out).toContain('--- log tail ---\ntail content')
  })
})

describe('defaultRun', () => {
  it('resolves code 0 on success', async () => {
    const r = await defaultRun(process.execPath, ['-e', 'process.exit(0)'], process.cwd())
    expect(r.code).toBe(0)
  })

  it('resolves the child exit code on failure', async () => {
    const r = await defaultRun(process.execPath, ['-e', 'process.exit(3)'], process.cwd())
    expect(r.code).toBe(3)
  })
})
