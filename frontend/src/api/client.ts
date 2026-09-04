/**
 * API client with dual-token (access + refresh) authentication.
 *
 * - Access token: short-lived JWT attached as the Authorization header.
 * - Refresh token: long-lived JWT (30d), only sent to /api/auth/refresh.
 *
 * On a 401 the client performs a single-flight refresh: concurrent failed
 * requests all await the same refresh call, then retry once. If the
 * refresh itself fails (expired/rotated/password changed), both tokens
 * are cleared and the app redirects to /login.
 *
 * A proactive refresh also runs on boot when the access token has less
 * than REFRESH_MARGIN left, so most sessions never see a 401 at all.
 */

const ACCESS_TOKEN_KEY = 'chaos-access-token'
const REFRESH_TOKEN_KEY = 'chaos-refresh-token'

/** Refresh when less than this remains (seconds). */
const REFRESH_MARGIN = 10 * 60

export class ApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

interface AppConfig {
  cdn?: string
  base_path?: string
  api?: string
  main_color?: string
}

function config(): AppConfig {
  const w = window as unknown as { __APP_CONFIG__?: AppConfig }
  return w.__APP_CONFIG__ ?? {}
}

export function basePath(): string {
  const bp = config().base_path
  if (!bp || bp === '/') return ''
  return bp.replace(/\/$/, '')
}

/* ------------------------------ token store ----------------------------- */

export function getAccessToken(): string {
  return localStorage.getItem(ACCESS_TOKEN_KEY) ?? ''
}

export function getRefreshToken(): string {
  return localStorage.getItem(REFRESH_TOKEN_KEY) ?? ''
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, access)
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh)
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function isLoggedIn(): boolean {
  return getAccessToken() !== '' || getRefreshToken() !== ''
}

/** Decode the `exp` field of a JWT without verification (scheduling only). */
function tokenExpiresAt(token: string): number {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const claims = JSON.parse(json) as { exp?: number }
    return claims.exp ?? 0
  } catch {
    return 0
  }
}

/* ------------------------------ refresh flow ---------------------------- */

let refreshPromise: Promise<void> | null = null

export interface RefreshResp {
  token: string
  refresh_token: string
  expires_in: number
}

async function performRefresh(): Promise<void> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    throw new ApiError(401, 'no refresh token')
  }
  const url = new URL(basePath() + '/api/auth/refresh', window.location.origin)
  const resp = await fetch(url.pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  const json = (await resp.json()) as {
    code: number
    message: string
    data: RefreshResp
  }
  if (!resp.ok || json.code !== 200) {
    throw new ApiError(json.code || resp.status, json.message || 'refresh failed')
  }
  setTokens(json.data.token, json.data.refresh_token)
}

/**
 * Single-flight refresh: the first caller triggers the HTTP refresh;
 * every concurrent caller awaits the same promise. Rotated refresh
 * tokens make retries unsafe, hence exactly-once semantics.
 */
function refreshSession(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = performRefresh()
      .catch((e) => {
        clearTokens()
        throw e
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/** Proactively renew when the access token is close to expiry. */
export async function ensureFreshToken(): Promise<void> {
  const access = getAccessToken()
  if (!access) return
  const remaining = tokenExpiresAt(access) - Date.now() / 1000
  if (remaining > 0 && remaining < REFRESH_MARGIN) {
    try {
      await refreshSession()
    } catch {
      // Reactive refresh on the next 401 will handle terminal failure.
    }
  }
}

/** Event fired when the session becomes unrecoverable (refresh failed). */
export const SESSION_EXPIRED_EVENT = 'chaos-session-expired'

function notifySessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

/* ------------------------------ core request ---------------------------- */

export interface RequestOptions {
  method?: string
  body?: unknown
  /** raw body (Blob/ArrayBuffer...) — skips JSON encoding */
  rawBody?: BodyInit
  /** extra headers, merged before auth */
  headers?: Record<string, string>
  query?: Record<string, string | number | undefined>
  signal?: AbortSignal
  /** Internal: marks the retry after a refresh to prevent loops. */
  _isRetry?: boolean
}

export async function request<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const url = new URL(basePath() + path, window.location.origin)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  const token = getAccessToken()
  if (token) headers['Authorization'] = token
  let body: BodyInit | undefined
  if (opts.rawBody !== undefined) {
    body = opts.rawBody
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const resp = await fetch(url.pathname + url.search, {
    method: opts.method ?? 'GET',
    headers,
    body,
    signal: opts.signal,
  })

  // The backend reports auth failures as HTTP 200 + {code: 401} envelopes
  // (see common.ErrorResp), so detect expiry from the envelope too.
  const unauthorized = resp.status === 401
  if (!resp.ok && !unauthorized) {
    let detail = `HTTP ${resp.status}`
    try {
      const j = (await resp.json()) as { message?: string }
      if (j?.message) detail = j.message
    } catch {
      /* non-json error body */
    }
    throw new ApiError(resp.status, detail)
  }

  const json = (await resp.json()) as { code: number; message: string; data: T }

  if (json.code === 401 && !opts._isRetry && getRefreshToken()) {
    // Access token expired (or was revoked). Try one silent refresh + retry.
    try {
      await refreshSession()
    } catch {
      notifySessionExpired()
      throw new ApiError(401, '登录已过期，请重新登录')
    }
    return request<T>(path, { ...opts, _isRetry: true })
  }

  if (json.code !== 200) {
    throw new ApiError(json.code, json.message || 'request failed')
  }
  return json.data
}

/** Raw login transport — returns both tokens without touching storage. */
export async function rawLogin(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<RefreshResp> {
  const url = new URL(basePath() + endpoint, window.location.origin)
  const resp = await fetch(url.pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await resp.json()) as {
    code: number
    message: string
    data: RefreshResp
  }
  if (!resp.ok || json.code !== 200) {
    throw new ApiError(json.code || resp.status, json.message || '登录失败')
  }
  return json.data
}

/** sha256 hex of "<password>-https://github.com/alist-org/alist" — the
 *  StaticHash the backend's /api/auth/login/hash expects. */
export async function staticHash(password: string): Promise<string> {
  const data = new TextEncoder().encode(
    `${password}-https://github.com/alist-org/alist`,
  )
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Build a download URL for an object (path-sign aware). */
export function downloadUrl(path: string, sign?: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const s = sign ? `?sign=${encodeURIComponent(sign)}` : ''
  return `${basePath()}/d${p}${s}`
}

/** Proxy (same-origin stream) URL — useful for previews. */
export function proxyUrl(path: string, sign?: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const s = sign ? `?sign=${encodeURIComponent(sign)}` : ''
  return `${basePath()}/p${p}${s}`
}
