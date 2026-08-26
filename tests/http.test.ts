import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProxyAgent } from 'undici'
import { clearHttpCache, fetchJson } from '../src/core/http.js'

const fetchMock = vi.fn()
const proxyAgentSpy = vi.fn()

vi.mock('undici', async (importOriginal) => {
  const mod = await importOriginal<typeof import('undici')>()
  class TestProxyAgent extends mod.ProxyAgent {
    constructor(uri: string) {
      proxyAgentSpy(uri)
      super(uri)
    }
  }
  return { ...mod, fetch: (...args: unknown[]) => fetchMock(...args), ProxyAgent: TestProxyAgent }
})

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const

function jsonResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  }
}

describe('fetchJson', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    fetchMock.mockReset()
    proxyAgentSpy.mockClear()
    clearHttpCache()
    for (const v of PROXY_VARS) {
      saved[v] = process.env[v]
      delete process.env[v]
    }
  })

  afterEach(() => {
    for (const v of PROXY_VARS) {
      if (saved[v] === undefined) delete process.env[v]
      else process.env[v] = saved[v]
    }
  })

  it('passes a ProxyAgent dispatcher when a proxy env var is set', async () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:7897'
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: 1 }))
    const r = await fetchJson('https://api.example.com/x')
    expect(r.ok).toBe(true)
    const opts = fetchMock.mock.calls[0][1] as { dispatcher?: unknown }
    expect(opts.dispatcher).toBeInstanceOf(ProxyAgent)
  })

  it('prefers HTTPS_PROXY over lower-priority vars', async () => {
    process.env.HTTP_PROXY = 'http://low:1'
    process.env.https_proxy = 'http://mid:1'
    process.env.HTTPS_PROXY = 'http://high:1'
    fetchMock.mockResolvedValueOnce(jsonResponse(200))
    await fetchJson('https://api.example.com/x')
    const opts = fetchMock.mock.calls[0][1] as { dispatcher?: unknown }
    expect(opts.dispatcher).toBeInstanceOf(ProxyAgent)
    expect(proxyAgentSpy).toHaveBeenCalledWith('http://high:1')
  })

  it('uses no dispatcher when no proxy env var is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200))
    await fetchJson('https://api.example.com/x')
    const opts = fetchMock.mock.calls[0][1] as { dispatcher?: unknown }
    expect(opts.dispatcher).toBeUndefined()
  })

  it('retries once after 429 honoring Retry-After and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: 1 }))
    const r = await fetchJson('https://api.example.com/x')
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns RATE_LIMITED when the retry is still 429', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'retry-after': '0' }))
    const r = await fetchJson('https://api.example.com/x')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('RATE_LIMITED')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('caches successful responses per URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: 1 }))
    const r1 = await fetchJson('https://api.example.com/cached')
    const r2 = await fetchJson('https://api.example.com/cached')
    expect(r1.ok && r2.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clearHttpCache forces a refetch', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: 1 }))
    await fetchJson('https://api.example.com/cached')
    clearHttpCache()
    await fetchJson('https://api.example.com/cached')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache error responses', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404))
    await fetchJson('https://api.example.com/nope')
    await fetchJson('https://api.example.com/nope')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
