import { describe, expect, it } from 'vitest'
import { parseBib, formatBib } from '../src/core/bib-parse.js'

const SAMPLE = `@article{vaswani2017attention,
  title = {Attention Is {A}ll {Y}ou {N}eed},
  author = "Vaswani, Ashish and Shazeer, Noam",
  year = {2017},
}

@book{knuth1984,
  title={The {TeX}book},
  publisher={Addison-Wesley},
  year = 1984
}
`

describe('parseBib', () => {
  it('parses entries with braced and quoted values', () => {
    const entries = parseBib(SAMPLE)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      type: 'article', key: 'vaswani2017attention',
      fields: { year: '2017', author: 'Vaswani, Ashish and Shazeer, Noam' },
    })
    expect(entries[1]!.fields.publisher).toBe('Addison-Wesley')
  })

  it('keeps nested braces in values', () => {
    const entries = parseBib(SAMPLE)
    expect(entries[0]!.fields.title).toBe('Attention Is {A}ll {Y}ou {N}eed')
  })

  it('returns empty array for text without entries', () => {
    expect(parseBib('% only a comment\n')).toEqual([])
  })
})

describe('formatBib', () => {
  it('round-trips entries in canonical form', () => {
    const out = formatBib(parseBib(SAMPLE))
    expect(out).toContain('@book{knuth1984,\n  title = {The {TeX}book},')
    expect(parseBib(out)).toHaveLength(2)
  })
})
