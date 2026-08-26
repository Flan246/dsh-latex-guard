import { execFile } from 'node:child_process'
import { readFile as fsReadFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { citeAudit } from './cite-audit.js'
import { err, ok, type Result } from './types.js'

export interface LogIssue { line: number | null; message: string; file: string | null }
export interface CheckReport {
  status: 'passed' | 'failed' | 'skipped'
  errors: LogIssue[]
  warnings: LogIssue[]
  missingCitations: string[]
  notice: string | null
}
export type Runner = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; log: string }>

interface Deps {
  run?: Runner
  which?: (cmd: string) => Promise<boolean>
  readFile?: (p: string) => Promise<string>
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
    }
  }
  return { errors, warnings, missingCitations: [...missing].sort() }
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
      errors: [], warnings: [], missingCitations,
      notice: 'latexmk not found on PATH; compile check skipped. Only cite audit was performed.',
    })
  }

  let code: number
  let log: string
  try {
    ;({ code, log } = await run('latexmk', ['-interaction=nonstopmode', '-pdf', entry], projectDir))
  } catch (e) {
    return err('LATEXMK_FAILED', e instanceof Error ? e.message : String(e))
  }
  const parsed = parseLog(log)
  return ok({
    status: code === 0 && parsed.errors.length === 0 ? 'passed' : 'failed',
    ...parsed,
    notice: null,
  })
}
