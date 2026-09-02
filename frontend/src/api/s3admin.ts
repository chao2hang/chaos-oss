import { request } from './client'

export interface S3AccessKey {
  id: number
  access_key: string
  buckets: string
  read_only: boolean
  enabled: boolean
  ip_allowlist: string
  remark: string
  created_time: string
  last_used_time: string
}

export interface S3KeyReq {
  access_key?: string
  secret_key?: string
  buckets?: string
  read_only?: boolean
  enabled?: boolean
  ip_allowlist?: string
  remark?: string
}

export function listS3Keys() {
  return request<S3AccessKey[]>('/api/admin/s3key/list')
}

/** Creates a key; server fills access_key/secret_key when omitted.
 * Returns the plaintext secret ONCE (only for generated keys). */
export function createS3Key(req: S3KeyReq) {
  return request<{ key: S3AccessKey; secret_key: string }>('/api/admin/s3key/create', {
    method: 'POST',
    body: req,
  })
}

export function updateS3Key(id: number, req: S3KeyReq) {
  return request<null>(`/api/admin/s3key/update/${id}`, {
    method: 'POST',
    body: req,
  })
}

export function deleteS3Key(id: number) {
  return request<null>(`/api/admin/s3key/delete/${id}`, {
    method: 'POST',
  })
}

export interface S3AuditLog {
  id: number
  access_key: string
  action: string
  bucket: string
  object: string
  status: number
  size: number
  duration: number
  client_ip: string
  created_at: string
}

export function listS3Audit(params: {
  page?: number
  per_page?: number
  key?: string
  bucket?: string
  action?: string
}) {
  return request<{ content: S3AuditLog[]; total: number }>('/api/admin/s3audit/list', {
    query: {
      page: String(params.page ?? 1),
      per_page: String(params.per_page ?? 20),
      ...(params.key ? { key: params.key } : {}),
      ...(params.bucket ? { bucket: params.bucket } : {}),
      ...(params.action ? { action: params.action } : {}),
    },
  })
}

export interface S3KeyStats {
  requests: number
  errors: number
  bytes_in: number
  bytes_out: number
  last_used: number
}

export interface S3Stats {
  since: string
  total: number
  errors: number
  bytes_in: number
  bytes_out: number
  replication_queue: number
  audit_queue: number
  by_keys: Record<string, S3KeyStats>
}

export function s3Stats() {
  return request<S3Stats>('/api/admin/s3/stats')
}
