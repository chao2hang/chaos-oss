import { request } from './client'

export interface TwoFASecret {
  qr: string // data:image/png;base64,...
  secret: string
}

/** Update own profile — username and/or password. */
export function updateMe(input: { username: string; password?: string }) {
  return request<unknown>('/api/me/update', {
    method: 'POST',
    body: input,
  })
}

/** Generate a 2FA QR code + secret (not yet bound). */
export function generate2FA() {
  return request<TwoFASecret>('/api/auth/2fa/generate', { method: 'POST' })
}

/** Bind 2FA by verifying a TOTP code against the secret. */
export function verify2FA(code: string, secret: string) {
  return request<unknown>('/api/auth/2fa/verify', {
    method: 'POST',
    body: { code, secret },
  })
}

/** Admin: remove a user's 2FA binding (query param id). */
export function cancel2FA(id: number) {
  return request<unknown>('/api/admin/user/cancel_2fa', {
    method: 'POST',
    query: { id: String(id) },
  })
}
