import { execFile } from 'node:child_process'
import { readFile as fsReadFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { citeAudit } from './cite-audit.js'
import { err, ok, type Result } from './types.js'

export interface LogIssue { line: number | null; message: string; file: string | null }
export type Engine = 'pdflatex' | 'xelatex' | 'lualatex'
export interface CheckReport {
  status: 'passed' | 'failed' | 'skipped'
  engine: Engine
  errors: LogIssue[]
  warnings: LogIssue[]
  missingCitations: string[]
  notice: string | null
  logTail: string | null
}
export type Runner = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; log: string }>

interface Deps {
  engine?: 'auto' | Engine
  run?: Runner
  which?: (cmd: string) => Promise<boolean>
  readFile?: (p: string) => Promise<string>
}

// Heuristic auto-detection from tex/cls content: an explicit
// `% !TeX program = ...` magic comment wins, then XeTeX markers (a doc may
// load both xeCJK and luatex stubs), then LuaTeX, else pdflatex.
export function detectEngine(tex: string): Engine {
  const magic = /^%+\s*!\s*TeX\s+program\s*=\s*(\S+)/im.exec(tex)
  if (magic) {
    const p = magic[1]!.toLowerCase()
    if (p.includes('xetex') || p.includes('xelatex')) return 'xelatex'
    if (p.includes('luatex') || p.includes('lualatex')) return 'lualatex'
  }
  if (/\\RequireXeTeX|xeCJK|\{ctex/.test(tex)) return 'xelatex'
  if (/\\RequireLuaTeX/.test(tex)) return 'lualatex'
  return 'pdflatex'
}

const ENGINE_FLAG: Record<Engine, string> = {
  pdflatex: '-pdf',
  xelatex: '-xelatex',
  lualatex: '-lualatex',
}

export function parseLog(log: string): Pick<CheckReport, 'errors' | 'warnings' | 'missingCitations'> {
  const errors: LogIssue[] = []
  const warnings: LogIssue[] = []
  const missing = new Set<string>()
  const lines = log.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (l.startsWith('! ')) {
      const at = lines.slice(i + 1).find((x) => x.startsWith('l.'))
      errors.push({ line: at ? Number(at.slice(2).split(' ')[0]) : null, message: l.slice(2).trim(), file: null })
    } else if (l.includes('LaTeX Warning:')) {
      warnings.push({ line: null, message: l.trim(), file: null })
      const c = /Citation '([^']+)'/.exec(l)
      if (c) missing.add(c[1]!)
    } else if (/^\s*\* /.test(l)) {
      // Engine fatal blocks (e.g. XeTeX's "* ... required ..." / "* Sorry!")
      // are delimited by ***... rules and never start with '! '. latexmk may
      // indent them one space and the log may carry CRLF endings.
      const block: string[] = []
      while (i < lines.length && /^\s*\* /.test(lines[i]!)) {
        block.push(lines[i]!.replace(/^\s*\* /, '').trim())
        i++
      }
      const text = block.join(' ')
      if (/sorry!/i.test(text) || /required/i.test(text)) {
        errors.push({ line: null, message: text, file: null })
      }
    }
  }
  return { errors, warnings, missingCitations: [...missing].sort() }
}

function logTailOf(log: string): string {
  const tail = log.split('\n').slice(-30).map((l) => l.replace(/\r$/, '')).join('\n')
  return tail.length > 2000 ? tail.slice(-2000) : tail
}

const defaultWhich: Deps['which'] = (cmd) => new Promise((resolve) => {
  execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (e) => resolve(!e))
})

export const defaultRun: Runner = (cmd, args, cwd) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    (e, stdout, stderr) => {
      if (e && (e as any).killed) return reject(new Error('latexmk timed out'))
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, log: stdout + stderr })
    })
})

export async function checkLatex(
  projectDir: string,
  entry: string,
  deps: Deps = {},
): Promise<Result<CheckReport>> {
  const which = deps.which ?? defaultWhich!
  const run = deps.run ?? defaultRun
  const read = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'))

  const entryPath = join(projectDir, entry)
  let tex: string
  try {
    tex = await read(entryPath)
  } catch {
    return err('NOT_FOUND', `entry not found: ${entryPath}`)
  }

  let engine: Engine
  if (deps.engine && deps.engine !== 'auto') {
    engine = deps.engine
  } else {
    engine = detectEngine(tex)
    if (engine === 'pdflatex') {
      // The entry tex often just says \documentclass{foo}; the engine markers
      // (e.g. \RequireXeTeX in cumcmthesis.cls) live in a local class file.
      const cls = /\\documentclass(?:\[[^\]]*\])?\{([^}/.]+)\}/.exec(tex)
      if (cls) {
        try {
          engine = detectEngine(await read(join(projectDir, `${cls[1]!}.cls`)))
        } catch { /* no local class file — keep pdflatex */ }
      }
    }
  }

  if (!(await which('latexmk'))) {
    // 降级：仍做引用审计（若旁边有 .bib）
    let missingCitations: string[] = []
    try {
      const bibPath = join(projectDir, basename(entry, '.tex') + '.bib')
      const bib = await read(bibPath)
      missingCitations = citeAudit([tex], bib).missingInBib
    } catch { /* 无 bib 则跳过 */ }
    return ok({
      status: 'skipped',
      engine,
      errors: [], warnings: [], missingCitations,
      notice: 'latexmk not found on PATH; compile check skipped. Only cite audit was performed.',
      logTail: null,
    })
  }

  let code: number
  let log: string
  try {
    ;({ code, log } = await run('latexmk', ['-interaction=nonstopmode', ENGINE_FLAG[engine], entry], projectDir))
  } catch (e) {
    return err('LATEXMK_FAILED', e instanceof Error ? e.message : String(e))
  }
  const parsed = parseLog(log)
  const status = code === 0 && parsed.errors.length === 0 ? 'passed' : 'failed'
  return ok({
    status,
    engine,
    ...parsed,
    notice: null,
    logTail: status === 'failed' && parsed.errors.length === 0 ? logTailOf(log) : null,
  })
}
