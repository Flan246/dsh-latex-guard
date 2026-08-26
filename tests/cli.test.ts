import { describe, expect, it } from 'vitest'
import { formatIssues, formatReport } from '../src/cli.js'

describe('formatIssues', () => {
  it('lists issues with key and detail', () => {
    const out = formatIssues([{ kind: 'missing-field', key: 'a2020', detail: 'missing: year' }])
    expect(out).toContain('a2020')
    expect(out).toContain('missing: year')
  })

  it('renders clean state', () => {
    expect(formatIssues([])).toBe('No issues found.')
  })
})

describe('formatReport', () => {
  it('shows status and counts', () => {
    const out = formatReport({
      status: 'failed', errors: [{ line: 12, message: 'boom', file: null }],
      warnings: [], missingCitations: ['ghost'], notice: null,
    })
    expect(out).toContain('failed')
    expect(out).toContain('boom')
    expect(out).toContain('ghost')
  })
})
