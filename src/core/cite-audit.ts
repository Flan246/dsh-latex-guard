import { parseBib } from './bib-parse.js'

// Alternation order matters: `cite` is a prefix substring of `citep`/`citet`,
// so a failed `\cite` attempt must be able to fall through to the longer names.
// `\nocite{key}` lists the entry in the bibliography without an in-text citation;
// it is treated as cited here (never uncited), while a key absent from the bib
// still lands in missingInBib — the plain `cited` set models this naturally.
const CITE_RE = /\\(?:cite|citep|citet|parencite|textcite|autocite|footcite|fullcite|nocite)(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g

export function citeAudit(
  texSources: string[],
  bibText: string,
): { missingInBib: string[]; uncited: string[] } {
  const cited = new Set<string>()
  for (const tex of texSources) {
    for (const m of tex.matchAll(CITE_RE)) {
      for (const k of m[1]!.split(',')) {
        const key = k.trim()
        if (key) cited.add(key)
      }
    }
  }
  const bibKeys = new Set(parseBib(bibText).map((e) => e.key))
  const missingInBib = [...cited].filter((k) => !bibKeys.has(k)).sort()
  const uncited = [...bibKeys].filter((k) => !cited.has(k)).sort()
  return { missingInBib, uncited }
}
