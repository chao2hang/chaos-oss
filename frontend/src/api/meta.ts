import { request } from './client'

/** Path-level metadata (permissions, password, hide, readme...). */
export interface Meta {
  id: number
  path: string
  read_users: number[]
  read_users_sub: boolean
  write_users: number[]
  write_users_sub: boolean
  password: string
  p_sub: boolean
  write: boolean
  w_sub: boolean
  hide: string
  h_sub: boolean
  readme: string
  r_sub: boolean
  header: string
  header_sub: boolean
}

export interface MetaPage {
  content: Meta[]
  total: number
}

export function listMetas(page = 1, perPage = 0) {
  return request<MetaPage>('/api/admin/meta/list', {
    query: { page: String(page), per_page: String(perPage) },
  })
}

export function createMeta(meta: Partial<Meta>) {
  return request<unknown>('/api/admin/meta/create', {
    method: 'POST',
    body: meta,
  })
}

export function updateMeta(meta: Partial<Meta>) {
  return request<unknown>('/api/admin/meta/update', {
    method: 'POST',
    body: meta,
  })
}

export function deleteMeta(id: number) {
  return request<unknown>('/api/admin/meta/delete', {
    method: 'POST',
    query: { id: String(id) },
  })
}
