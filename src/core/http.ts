import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { err, ok, type Result } from './types.js'

const UA = 'dsh-latex-guard/0.1.1 (mailto:latex-guard@users.noreply.github.com)'
const TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 200
const CACHE_EVICT_BATCH = 20

const cache = new Map<string, { data: unknown; expiry: number }>()

export function clearHttpCache(): void {
  cache.clear()
  resetProxyAgent()
}

let cachedProxy: { url: string; agent: ProxyAgent } | null = null

function resetProxyAgent(): void {
  if (cachedProxy) {
    void cachedProxy.agent.close()
    cachedProxy = null
  }
}

function proxyDispatcher(): ProxyAgent | undefined {
  const proxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (!proxy) {
    resetProxyAgent()
    return undefined
  }
  if (cachedProxy?.url !== proxy) {
    resetProxyAgent()
    cachedProxy = { url: proxy, agent: new ProxyAgent(proxy) }
  }
  return cachedProxy.agent
}

// Injectable so tests can substitute or spy without real waiting.
let sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function retryAfterMs(res: { headers: { get(name: string): string | null } }): number {
  const raw = res.headers.get('retry-after')
  const seconds = raw === null ? NaN : Number(raw)
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : 1) * 1000
}

function cacheSet(url: string, data: unknown): void {
  if (cache.size >= CACHE_MAX) {
    let removed = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      if (++removed >= CACHE_EVICT_BATCH) break
    }
  }
  cache.set(url, { data, expiry: Date.now() + CACHE_TTL_MS })
}

async function request(url: string) {
  return undiciFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    dispatcher: proxyDispatcher(),
  })
}

export async function fetchJson(url: string): Promise<Result<unknown>> {
  const hit = cache.get(url)
  if (hit) {
    if (hit.expiry > Date.now()) return ok(hit.data)
    cache.delete(url)
  }
  let lastErr: Result<unknown> | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let res = await request(url)
      if (res.status === 429) {
        // Drain the body so undici can reuse the connection; cancel is the standard
        // ReadableStream method (fetch bodies have no dump()). Failure must not block the retry.
        try { await res.body?.cancel() } catch { /* ignore */ }
        await sleep(retryAfterMs(res))
        res = await request(url)
        if (res.status === 429) return err('RATE_LIMITED', `429: ${url}`)
      }
      if (res.status === 404) return err('NOT_FOUND', `404: ${url}`)
      if (!res.ok) { lastErr = err('HTTP_' + res.status, `${res.status}: ${url}`); continue }
      const data: unknown = await res.json()
      cacheSet(url, data)
      return ok(data)
    } catch (e) {
      lastErr = err('NETWORK', e instanceof Error ? e.message : String(e))
    }
  }
  return lastErr ?? err('NETWORK', 'unreachable')
}
