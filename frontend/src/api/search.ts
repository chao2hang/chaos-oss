import { request } from './client'

export interface SearchNode {
  parent: string
  name: string
  is_dir: boolean
  size: number
  type: number
}

export interface SearchPage {
  content: SearchNode[]
  total: number
}

/** Full-text search below a parent path (requires a built index). */
export function fsSearch(
  parent: string,
  keywords: string,
  opts: { scope?: number; page?: number; perPage?: number; password?: string } = {},
) {
  return request<SearchPage>('/api/fs/search', {
    method: 'POST',
    body: {
      parent,
      keywords,
      scope: opts.scope ?? 0,
      password: opts.password ?? '',
      page: opts.page ?? 1,
      per_page: opts.perPage ?? 100,
    },
  })
}

/* ------------------------------- index admin ------------------------------ */

export interface IndexProgress {
  obj_count: number
  is_done: boolean
  last_done_time: string | null
  error: string
}

export function indexBuild() {
  return request<unknown>('/api/admin/index/build', { method: 'POST' })
}

export function indexUpdate() {
  return request<unknown>('/api/admin/index/update', { method: 'POST' })
}

export function indexStop() {
  return request<unknown>('/api/admin/index/stop', { method: 'POST' })
}

export function indexClear() {
  return request<unknown>('/api/admin/index/clear', { method: 'POST' })
}

export function indexProgress() {
  return request<IndexProgress>('/api/admin/index/progress')
}
