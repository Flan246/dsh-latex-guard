import { formatBib, parseBib } from './bib-parse.js'
import { fetchJson as defaultFetchJson } from './http.js'
import { ok, type Result } from './types.js'

interface Deps { fetchJson?: typeof defaultFetchJson }

/* eslint-disable @typescript-eslint/no-explicit-any */
function fieldsFromWork(w: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (w.title?.[0]) out.title = String(w.title[0])
  if (Array.isArray(w.author) && w.author.length) {
    out.author = w.author.map((a: any) => [a.family, a.given].filter(Boolean).join(', ')).join(' and ')
  }
  const venue = w['container-title']?.[0]
  if (venue) out[w.type === 'journal-article' ? 'journal' : 'booktitle'] = String(venue)
  const year = w.published?.['date-parts']?.[0]?.[0]
  if (year) out.year = String(year)
  if (w.volume) out.volume = String(w.volume)
  if (w.issue) out.number = String(w.issue)
  if (w.page) out.pages = String(w.page)
  if (w.DOI) out.doi = String(w.DOI).toLowerCase()
  return out
}

export async function fillBib(
  text: string,
  deps: Deps = {},
): Promise<Result<{ fixed: string; filled: string[]; missing: string[] }>> {
  const fj = deps.fetchJson ?? defaultFetchJson
  const entries = parseBib(text)
  const filled: string[] = []
  const missing: string[] = []
  for (const e of entries) {
    let r: Result<unknown> | null = null
    if (e.fields.doi) {
      r = await fj(`https://api.crossref.org/works/${encodeURIComponent(e.fields.doi)}`)
    } else if (e.fields.title) {
      r = await fj(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(e.fields.title)}&rows=1`)
    }
    if (!r) { missing.push(e.key); continue }
    if (!r.ok) { missing.push(e.key); continue }
    const data: any = r.data
    const work = e.fields.doi ? data?.message : data?.message?.items?.[0]
    if (!work) { missing.push(e.key); continue }
    let touched = false
    for (const [k, v] of Object.entries(fieldsFromWork(work))) {
      if (!e.fields[k]?.trim()) { e.fields[k] = v; touched = true }
    }
    if (touched) filled.push(e.key)
  }
  return ok({ fixed: formatBib(entries), filled, missing })
}
