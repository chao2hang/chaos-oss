import { request, getAccessToken, setTokens, basePath } from './client'

/* ------------------------------ SSH public keys ------------------------------ */

export interface SSHKey {
  id: number
  title: string
  fingerprint: string
  added_time: string
  last_used_time: string
}

export function listMySSHKeys() {
  return request<{ content: SSHKey[]; total: number }>('/api/me/sshkey/list', {
    query: { page: '1', per_page: '0' },
  })
}

export function addMySSHKey(title: string, key: string) {
  return request<unknown>('/api/me/sshkey/add', {
    method: 'POST',
    body: { title, key },
  })
}

export function deleteMySSHKey(id: number) {
  return request<unknown>('/api/me/sshkey/delete', {
    method: 'POST',
    query: { id: String(id) },
  })
}

/* ------------------------------ messages ------------------------------ */

export interface SiteMessage {
  type: string
  content: unknown
}

/** Fetch one pending announcement (404 "no message" when empty). */
export function getMessage() {
  return request<SiteMessage>('/api/admin/message/get', { method: 'POST' })
}

/* ------------------------------ WebAuthn ------------------------------ */

/** base64url → Uint8Array (WebAuthn buffers). */
function b64uToBuf(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** ArrayBuffer → base64url without padding. */
function bufToB64u(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface WebAuthnBeginResp {
  options: {
    response?: Record<string, unknown>
    publicKey?: Record<string, unknown>
    [k: string]: unknown
  }
  /** base64-encoded JSON webauthn.SessionData */
  session: string
}

/** Deep-convert base64url strings to Uint8Array where the WebAuthn API expects buffers. */
function normalizeOptions(pk: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...pk }
  if (typeof out.challenge === 'string') out.challenge = b64uToBuf(out.challenge)
  const user = out.user as Record<string, unknown> | undefined
  if (user && typeof user.id === 'string') out.user = { ...user, id: b64uToBuf(user.id) }
  const excludeCredentials = out.excludeCredentials as { id: string }[] | undefined
  if (Array.isArray(excludeCredentials)) {
    out.excludeCredentials = excludeCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) }))
  }
  const allowCredentials = out.allowCredentials as { id: string }[] | undefined
  if (Array.isArray(allowCredentials)) {
    out.allowCredentials = allowCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) }))
  }
  return out
}

/** id is the credential ID as a byte array (JSON) — used opaque. */
export interface WebAuthnCredentialInfo {
  id: number[]
  fingerprint: string
}

export function webauthnCredentials() {
  return request<WebAuthnCredentialInfo[]>('/api/authn/getcredentials')
}

/** Register the platform passkey for the logged-in user. */
export async function webauthnRegister(): Promise<void> {
  const begin = await request<WebAuthnBeginResp>('/api/authn/webauthn_begin_registration')
  const pk = (begin.options.publicKey ?? begin.options.response ?? {}) as Record<string, unknown>
  const normalized = normalizeOptions(pk)
  const credential = (await navigator.credentials.create({
    publicKey: normalized as unknown as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAttestationResponse
  const body = {
    id: credential.id,
    rawId: bufToB64u(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufToB64u(response.attestationObject),
      clientDataJSON: bufToB64u(response.clientDataJSON),
    },
  }
  await request('/api/authn/webauthn_finish_registration', {
    method: 'POST',
    headers: { Session: begin.session },
    body,
  })
}

/** Passkey login — stores the returned access token. */
export async function webauthnLogin(username?: string): Promise<void> {
  const q = username ? `?username=${encodeURIComponent(username)}` : ''
  const begin = await request<WebAuthnBeginResp>(`/api/authn/webauthn_begin_login${q}`)
  const pk = (begin.options.publicKey ?? begin.options.response ?? {}) as Record<string, unknown>
  const credential = (await navigator.credentials.get({
    publicKey: normalizeOptions(pk) as unknown as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential
  const response = credential.response as AuthenticatorAssertionResponse
  const body = {
    id: credential.id,
    rawId: bufToB64u(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufToB64u(response.authenticatorData),
      clientDataJSON: bufToB64u(response.clientDataJSON),
      signature: bufToB64u(response.signature),
      userHandle: response.userHandle ? bufToB64u(response.userHandle) : undefined,
    },
  }
  const finish = await request<{ token: string }>(`/api/authn/webauthn_finish_login${q}`, {
    method: 'POST',
    headers: { session: begin.session },
    body,
  })
  // WebAuthn issues an access token only — no refresh token.
  setTokens(finish.token, '')
}

/** Delete one of the current user's WebAuthn credentials.
 * The server matches base64(credential ID); the list returns the raw bytes. */
export function webauthnDelete(idBytes: number[]) {
  let bin = ''
  for (let i = 0; i < idBytes.length; i += 0x8000) {
    bin += String.fromCharCode(...idBytes.slice(i, i + 0x8000))
  }
  return request<unknown>('/api/authn/delete_authn', {
    method: 'POST',
    body: { id: btoa(bin) },
  })
}

export { getAccessToken, basePath }
