import { describe, expect, it } from 'vitest'
import { lintBib } from '../src/core/bib-lint.js'

const DUP = `@article{a2020,
  author = {Zhang, A}, title = {T}, journal = {J}, year = {2020},
}
@article{a2020,
  author = {Li, B}, title = {T2}, journal = {J}, year = {2021},
}
@misc{b2022,
  title = {Only Title},
}
`

describe('lintBib', () => {
  it('flags duplicate keys and drops later copies in fixed output', () => {
    const { issues, fixed } = lintBib(DUP)
    expect(issues.filter((i) => i.kind === 'duplicate-key')).toHaveLength(1)
    expect(fixed.match(/@article\{a2020/g)).toHaveLength(1)
    expect(fixed).toContain('Zhang, A')
    expect(fixed).not.toContain('Li, B')
  })

  it('flags missing required fields per entry type', () => {
    const { issues } = lintBib(DUP)
    const miss = issues.find((i) => i.kind === 'missing-field' && i.key === 'b2022')
    expect(miss?.detail).toContain('author')
    expect(miss?.detail).toContain('year')
  })

  it('flags book missing title', () => {
    const { issues } = lintBib('@book{b1,\n  author={A},\n  publisher={P},\n  year={2020},\n}\n')
    const miss = issues.find((i) => i.kind === 'missing-field' && i.key === 'b1')
    expect(miss?.detail).toContain('title')
  })

  it('clean input yields no issues and canonical formatting', () => {
    const { issues, fixed } = lintBib('@article{x,\n  author={A},\n  title={T},\n  journal={J},\n  year={2020},\n}\n')
    expect(issues).toEqual([])
    expect(fixed).toContain('  author = {A},')
  })
})
