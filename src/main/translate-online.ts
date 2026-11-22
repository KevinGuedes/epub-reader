import { buildLookupUrl, parseLookupResponse, type TranslateResult } from '../shared/translate'

const TIMEOUT_MS = 8000
const MAX_RESPONSE_CHARS = 200_000
const CACHE_SIZE = 200

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  text(): Promise<string>
}>

/**
 * Translates a short selection through Google's undocumented web endpoint. Runs in the main process (the renderer's
 * CSP stays closed). Because the endpoint is unofficial it can change or throttle at any time, so every failure
 * becomes a typed result the UI can explain, and the last answers are cached to avoid repeated requests.
 */
export class OnlineTranslator {
  private readonly cache = new Map<string, TranslateResult & { ok: true }>()

  constructor(private readonly fetchFn: FetchLike) {}

  async lookup(text: string, bookLanguage: string | null): Promise<TranslateResult> {
    const url = buildLookupUrl(text, bookLanguage)
    const cached = this.cache.get(url)
    if (cached) {
      this.cache.delete(url) // refresh recency
      this.cache.set(url, cached)
      return cached
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await this.fetchFn(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      if (response.status === 429 || response.status === 403) return { ok: false, reason: 'blocked' }
      if (!response.ok) return { ok: false, reason: 'failed' }
      const body = await response.text()
      if (body.length > MAX_RESPONSE_CHARS) return { ok: false, reason: 'failed' }
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return { ok: false, reason: 'failed' } // e.g. an HTML consent/captcha page instead of JSON
      }
      const result = parseLookupResponse(parsed)
      if (!result) return { ok: false, reason: 'failed' }
      this.cache.set(url, result)
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as string)
      return result
    } catch (error) {
      // fetch rejects with a TypeError for network problems (offline, DNS, TLS); an abort is our own timeout.
      const aborted = error instanceof Error && error.name === 'AbortError'
      return { ok: false, reason: aborted ? 'failed' : 'offline' }
    } finally {
      clearTimeout(timer)
    }
  }
}
