import { describe, expect, it } from 'vitest'
import { citeAudit } from '../src/core/cite-audit.js'

const BIB = `@article{a2020,\n  author={A}, title={T}, journal={J}, year={2020},\n}\n@misc{unused,\n  author={B}, title={U}, year={2021},\n}\n`

describe('citeAudit', () => {
  it('finds cited keys missing from bib and bib entries never cited', () => {
    const tex = '见 \\cite{a2020,ghost2023} 与 \\citep[见][第3页]{a2020}。'
    const r = citeAudit([tex], BIB)
    expect(r.missingInBib).toEqual(['ghost2023'])
    expect(r.uncited).toEqual(['unused'])
  })

  it('merges keys across multiple tex sources', () => {
    const r = citeAudit(['\\cite{a2020}', '\\textcite{unused}'], BIB)
    expect(r.missingInBib).toEqual([])
    expect(r.uncited).toEqual([])
  })

  it('recognizes biblatex \\autocite', () => {
    const r = citeAudit(['见 \\autocite{a2020}。'], BIB)
    expect(r.missingInBib).toEqual([])
    expect(r.uncited).toEqual(['unused'])
  })

  it('recognizes biblatex \\footcite with two optional args', () => {
    const r = citeAudit(['\\footcite[see][p. 2]{a2020,ghost2023}'], BIB)
    expect(r.missingInBib).toEqual(['ghost2023'])
    expect(r.uncited).toEqual(['unused'])
  })

  it('treats \\nocite keys as cited, still reported when missing from bib', () => {
    // \nocite lists the entry in the bibliography without an in-text citation:
    // its key counts as cited (never uncited), but a missing bib entry is still missingInBib.
    const r = citeAudit(['\\nocite{unused,ghost2023}'], BIB)
    expect(r.missingInBib).toEqual(['ghost2023'])
    expect(r.uncited).toEqual(['a2020'])
  })

  it('does not mis-match \\cite against \\citep/\\citet prefixes', () => {
    const r = citeAudit(['\\citep{a2020} \\citet{unused}'], BIB)
    expect(r.missingInBib).toEqual([])
    expect(r.uncited).toEqual([])
  })
})
