import { formatBib, parseBib } from './bib-parse.js'
import type { BibEntry } from './types.js'

export interface LintIssue {
  kind: 'duplicate-key' | 'missing-field'
  key: string
  detail: string
}

const REQUIRED: Record<string, string[]> = {
  article: ['author', 'title', 'journal', 'year'],
  book: ['title', 'publisher', 'year'],
  inproceedings: ['author', 'title', 'booktitle', 'year'],
}

function requiredFields(e: BibEntry): string[] {
  return REQUIRED[e.type] ?? ['author', 'title', 'year']
}

export function lintBib(text: string): { issues: LintIssue[]; fixed: string } {
  const entries = parseBib(text)
  const issues: LintIssue[] = []
  const seen = new Set<string>()
  const kept: BibEntry[] = []
  for (const e of entries) {
    if (seen.has(e.key)) {
      issues.push({ kind: 'duplicate-key', key: e.key, detail: `duplicate entry key '${e.key}', later copy dropped` })
      continue
    }
    seen.add(e.key)
    kept.push(e)
    const missing = requiredFields(e).filter((f) => !e.fields[f]?.trim())
    if (e.type === 'book' && !e.fields.author?.trim() && !e.fields.editor?.trim()) {
      missing.push('author/editor')
    }
    if (missing.length) {
      issues.push({ kind: 'missing-field', key: e.key, detail: `missing: ${missing.join(', ')}` })
    }
  }
  return { issues, fixed: formatBib(kept) }
}
