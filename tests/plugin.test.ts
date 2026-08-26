import { describe, expect, it } from 'vitest'
import * as plugin from '../src/plugin.js'

describe('plugin', () => {
  it('exports cordis plugin contract', () => {
    expect(plugin.name).toBe('dsh-latex-guard')
    expect(plugin.inject).toEqual(['tools'])
    expect(typeof plugin.apply).toBe('function')
  })

  it('registers 4 tools on apply', () => {
    const registered: any[] = []
    const ctx = { tools: { register: (t: any) => registered.push(t) } }
    plugin.apply(ctx as any)
    expect(registered.map((t) => t.name).sort()).toEqual(
      ['bib_fill', 'bib_lint', 'cite_audit', 'latex_check'])
  })
})
