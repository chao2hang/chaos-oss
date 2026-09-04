import { request } from './client'

/** A sharing record (server/handles/sharing.go SharingResp). */
export interface Sharing {
  id: string
  files: string[]
  expires: string | null
  pwd: string
  accessed: number
  max_accessed: number
  disabled: boolean
  remark: string
  readme: string
  header: string
  creator_name?: string
  creator_role?: number
}

export interface SharePage {
  content: Sharing[]
  total: number
}

/** List sharings — admins see all, users see their own. */
export function shareList(page = 1, perPage = 0) {
  return request<SharePage>('/api/share/list', {
    method: 'POST',
    body: { page, per_page: perPage },
  })
}

export interface ShareInput {
  files: string[]
  pwd?: string
  expires?: string | null
  max_accessed?: number
  remark?: string
  readme?: string
  header?: string
  disabled?: boolean
}

export function shareCreate(input: ShareInput) {
  return request<Sharing>('/api/share/create', {
    method: 'POST',
    body: input,
  })
}

export function shareUpdate(id: string, input: Partial<ShareInput>) {
  return request<Sharing>('/api/share/update', {
    method: 'POST',
    body: { id, ...input },
  })
}

export function shareDelete(id: string) {
  return request<unknown>('/api/share/delete', {
    method: 'POST',
    query: { id },
  })
}

export function shareSetDisabled(id: string, disabled: boolean) {
  return request<unknown>(`/api/share/${disabled ? 'disable' : 'enable'}`, {
    method: 'POST',
    query: { id },
  })
}

/** Public URL of a share page. */
export function shareUrl(sid: string, pwd?: string): string {
  const q = pwd ? `?pwd=${encodeURIComponent(pwd)}` : ''
  return `${window.location.origin}${basePathSafe()}/s/${sid}${q}`
}

function basePathSafe(): string {
  try {
    const w = window as unknown as { __APP_CONFIG__?: { base_path?: string } }
    const bp = w.__APP_CONFIG__?.base_path
    return bp && bp !== '/' ? bp.replace(/\/$/, '') : ''
  } catch {
    return ''
  }
}

/** Direct download link for an object inside a share. */
export function shareDownloadUrl(sid: string, relPath: string, pwd?: string): string {
  const p = relPath === '/' ? '' : relPath.startsWith('/') ? relPath : `/${relPath}`
  const q = pwd ? `?pwd=${encodeURIComponent(pwd)}` : ''
  return `${basePathSafe()}/sd/${sid}${p}${q}`
}
