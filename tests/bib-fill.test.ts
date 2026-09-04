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

  it('classifies network failures into failed with the error code', async () => {
    const fetchJson = vi.fn(async () => err('NETWORK', 'connect timeout'))
    const r = await fillBib(BIB, { fetchJson })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.missing).toEqual([])
    expect(r.data.failed).toEqual(['zhang2020 (NETWORK)'])
  })

  it('classifies rate limiting into failed', async () => {
    const fetchJson = vi.fn(async () => err('RATE_LIMITED', '429'))
    const r = await fillBib(BIB, { fetchJson })
    expect(r.ok && r.data.failed).toEqual(['zhang2020 (RATE_LIMITED)'])
    expect(r.ok && r.data.missing).toEqual([])
  })

  it('separates missing and failed in a mixed scenario', async () => {
    const bib = BIB +
      '@article{lee2021,\n  title = {No Such},\n  doi = {10.1000/absent},\n}\n' +
      '@misc{empty,\n  note = {x},\n}\n'
    const fetchJson = vi.fn(async (url: string) =>
      url.includes('absent') ? err('NOT_FOUND', '404') : err('NETWORK', 'proxy down'))
    const r = await fillBib(bib, { fetchJson })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.missing).toEqual(['lee2021', 'empty'])
    expect(r.data.failed).toEqual(['zhang2020 (NETWORK)'])
  })
})
