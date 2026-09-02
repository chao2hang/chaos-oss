import { request } from './client'
import type { Storage, User, SettingItem } from './types'

/* ---------------- drivers ---------------- */

/** Form field definition served by the Go backend (internal/driver/item.go). */
export interface DriverItem {
  name: string
  type: 'text' | 'number' | 'bool' | 'select' | string
  default: string
  options: string
  required: boolean
  help: string
}

export interface DriverInfo {
  common: DriverItem[]
  additional: DriverItem[]
  config: {
    name: string
    default_root: string
    local_sort: boolean
    [key: string]: unknown
  }
}

export function listDrivers() {
  return request<Record<string, DriverInfo>>('/api/admin/driver/list')
}

export function getDriverInfo(driver: string) {
  return request<DriverInfo>('/api/admin/driver/info', { query: { driver } })
}

/* ---------------- storages ---------------- */

export interface StorageListResp {
  content: Storage[]
  total: number
}

export function listStorages() {
  return request<StorageListResp>('/api/admin/storage/list')
}

export interface CreateStorageReq {
  mount_path: string
  driver: string
  addition: string
  order?: number
  remark?: string
  cache_expiration?: number
}

export function createStorage(req: CreateStorageReq) {
  return request<{ id: number }>('/api/admin/storage/create', {
    method: 'POST',
    body: req,
  })
}

export function getStorage(id: number) {
  return request<Storage>('/api/admin/storage/get', { query: { id } })
}

export function updateStorage(req: CreateStorageReq & { id: number }) {
  return request<never>('/api/admin/storage/update', {
    method: 'POST',
    body: req,
  })
}

export function deleteStorage(id: number) {
  // NOTE: the Go handlers read id from the query string, not the body.
  return request<never>(`/api/admin/storage/delete`, {
    method: 'POST',
    query: { id },
  })
}

export function enableStorage(id: number, enable: boolean) {
  const path = enable ? '/api/admin/storage/enable' : '/api/admin/storage/disable'
  return request<never>(path, { method: 'POST', query: { id } })
}

/* ---------------- 123 云盘 OAuth 助手 ---------------- */

export function pan123OAuthInfo() {
  return request<{ auth_url: string; redirect_uri: string }>(
    '/api/admin/123pan/oauth_info',
  )
}

export function pan123OAuthToken(code?: string, refreshToken?: string) {
  return request<{
    token_type: string
    access_token: string
    refresh_token: string
    expires_in: number
  }>('/api/admin/123pan/oauth_token', {
    method: 'POST',
    body: { code: code ?? '', refresh_token: refreshToken ?? '' },
  })
}

/* ---------------- users ---------------- */

export interface UserListResp {
  content: User[]
  total: number
}

export function listUsers() {
  return request<UserListResp>('/api/admin/user/list')
}

export function createUser(user: Partial<User>) {
  return request<User>('/api/admin/user/create', { method: 'POST', body: user })
}

export function updateUser(user: Partial<User>) {
  return request<never>('/api/admin/user/update', { method: 'POST', body: user })
}

export function deleteUser(id: number) {
  // The Go handler reads id from the query string, not the body.
  return request<never>('/api/admin/user/delete', {
    method: 'POST',
    query: { id },
  })
}

/* ---------------- settings ---------------- */

export function listSettings() {
  // NOTE: this endpoint returns a bare array in `data`, unlike
  // storage/user list which wrap in {content, total}.
  return request<SettingItem[]>('/api/admin/setting/list')
}

export function saveSettings(items: { key: string; value: string }[]) {
  return request<never>('/api/admin/setting/save', {
    method: 'POST',
    body: items,
  })
}

/* ------------------------------ manual scan ------------------------------ */

export interface ScanProgress {
  obj_count: number
  is_done: boolean
}

/** Start a manual recursive scan (limit 0 = unlimited). */
export function scanStart(path: string, limit = 0) {
  return request<unknown>('/api/admin/scan/start', {
    method: 'POST',
    body: { path, limit },
  })
}

export function scanStop() {
  return request<unknown>('/api/admin/scan/stop', { method: 'POST' })
}

export function scanProgress() {
  return request<ScanProgress>('/api/admin/scan/progress')
}

/** Interactive 189CloudPC login helper (captcha round-trip capable). */
export function cloud189Login(input: {
  username?: string
  password?: string
  validate_code?: string
  state?: string
}) {
  return request<{
    need_captcha: boolean
    captcha_image?: string
    state: string
    session?: {
      login_name: string
      session_key: string
      session_secret: string
      family_session_key: string
      family_session_secret: string
      access_token: string
      refresh_token: string
    }
  }>('/api/admin/189cloud/login', {
    method: 'POST',
    body: {
      username: input.username ?? '',
      password: input.password ?? '',
      validate_code: input.validate_code ?? '',
      state: input.state ?? '',
    },
  })
}
