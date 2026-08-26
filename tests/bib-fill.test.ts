import { describe, expect, it, vi } from 'vitest'
import { fillBib } from '../src/core/bib-fill.js'
import { ok, err } from '../src/core/types.js'

const BIB = `@article{zhang2020,
  author = {Zhang, A},
  title = {Deep Stuff},
  doi = {10.1000/xyz},
}
`

const crossrefWork = {
  message: {
    DOI: '10.1000/xyz', title: ['Deep Stuff'],
    author: [{ given: 'A', family: 'Zhang' }],
    published: { 'date-parts': [[2020]] },
    'container-title': ['Nature'], volume: '580', issue: '7802', page: '1-5',
    type: 'journal-article',
  },
}

describe('fillBib', () => {
  it('fills missing fields from crossref without overwriting', async () => {
    const fetchJson = vi.fn(async () => ok(crossrefWork))
    const r = await fillBib(BIB, { fetchJson })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.fixed).toContain('journal = {Nature}')
    expect(r.data.fixed).toContain('year = {2020}')
    expect(r.data.fixed).toContain('author = {Zhang, A}')
    expect(r.data.filled).toEqual(['zhang2020'])
  })

  it('collects entries whose doi cannot be resolved', async () => {
    const fetchJson = vi.fn(async () => err('NOT_FOUND', '404'))
    const r = await fillBib(BIB, { fetchJson })
    expect(r.ok && r.data.missing).toEqual(['zhang2020'])
  })

  it('leaves entries without doi and title untouched', async () => {
    const fetchJson = vi.fn(async () => ok(crossrefWork))
    const r = await fillBib('@misc{empty,\n  note = {x},\n}\n', { fetchJson })
    expect(r.ok && r.data.missing).toEqual(['empty'])
    expect(fetchJson).not.toHaveBeenCalled()
  })
})
