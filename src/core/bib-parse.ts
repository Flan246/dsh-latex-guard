import type { BibEntry } from './types.js'

export function parseBib(text: string): BibEntry[] {
  const entries: BibEntry[] = []
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('@', i)
    if (at === -1) break
    const head = /^@([a-zA-Z]+)\s*\{/.exec(text.slice(at, at + 64))
    if (!head) { i = at + 1; continue }
    const type = head[1]!.toLowerCase()
    const open = at + head[0].length - 1
    const close = matchBrace(text, open)
    if (close === -1) break
    const raw = text.slice(at, close + 1)
    const body = text.slice(open + 1, close)
    const comma = body.indexOf(',')
    const key = (comma === -1 ? body : body.slice(0, comma)).trim()
    entries.push({ type, key, fields: parseFields(comma === -1 ? '' : body.slice(comma + 1)), raw })
    i = close + 1
  }
  return entries
}

function matchBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return -1
}

function parseFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let i = 0
  while (i < body.length) {
    const m = /^\s*([a-zA-Z]+)\s*=\s*/.exec(body.slice(i))
    if (!m) break
    const name = m[1]!.toLowerCase()
    i += m[0].length
    let value = ''
    if (body[i] === '{') {
      const close = matchBrace(body, i)
      if (close === -1) break
      value = body.slice(i + 1, close)
      i = close + 1
    } else if (body[i] === '"') {
      const close = body.indexOf('"', i + 1)
      value = body.slice(i + 1, close === -1 ? undefined : close)
      i = close === -1 ? body.length : close + 1
    } else {
      const m2 = /[^,]+/.exec(body.slice(i))
      value = (m2?.[0] ?? '').trim()
      i += m2?.[0].length ?? 0
    }
    fields[name] = value
    const next = body.indexOf(',', i)
    i = next === -1 ? body.length : next + 1
  }
  return fields
}

// Heuristic completeness guard for --write paths. parseBib stops at the
// first entry whose braces never close (matchBrace === -1 → break), silently
// dropping that entry and everything after it; formatBib then only re-emits
// the parsed prefix, so writing the result back would truncate the file.
// We count raw `@type{` markers and refuse to write when there are more
// markers than parsed entries.
// Boundary: markers inside field values or comment lines are counted too,
// while parseBib skips content already consumed inside an entry — so a
// well-formed file containing a literal `@foo{` inside an entry body can
// trip a false positive. That direction is safe: the guard only ever
// refuses a write, it never corrupts data.
export function isFullyParsed(text: string): boolean {
  const markers = text.match(/@[a-zA-Z]+\s*\{/g)?.length ?? 0
  return markers <= parseBib(text).length
}

export function formatBib(entries: BibEntry[]): string {
  return entries.map((e) => {
    const lines = Object.entries(e.fields).map(([k, v]) => `  ${k} = {${v}}`)
    return `@${e.type}{${e.key},\n${lines.join(',\n')}\n}`
  }).join('\n\n') + '\n'
}
