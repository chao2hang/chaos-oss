import { request, getAccessToken, basePath } from './client'
import { joinPath } from '../lib/format'

/** Server-side view of one resumable upload session. */
export interface MultipartSnapshot {
  upload_id: string
  state: number
  attempt: number
  path: string
  size: number
  chunk_size: number
  total_chunks: number
  /** received chunk-index ranges, inclusive [start, end] */
  received: [number, number][]
  received_bytes: number
  frontier: number
  storage_progress: number
  error?: string
}

/** Init (or resume) a multipart upload session for one file. */
export function multipartInit(
  dir: string,
  relPath: string,
  file: File,
): Promise<MultipartSnapshot & { resumed: boolean }> {
  return request('/api/fs/multipart/init', {
    method: 'POST',
    headers: {
      'File-Path': encodeURIComponent(joinPath(dir, relPath)),
      'X-File-Size': String(file.size),
      'As-Task': 'false',
      'Content-Type': file.type || 'application/octet-stream',
    },
  })
}

/** Upload one chunk (raw body). 429 = flow control, 409 = chunk in flight. */
export function multipartChunk(
  uploadId: string,
  index: number,
  blob: Blob,
): Promise<MultipartSnapshot> {
  return request('/api/fs/multipart/chunk', {
    method: 'PUT',
    headers: {
      'X-Upload-Id': uploadId,
      'X-Chunk-Index': String(index),
      'Content-Type': 'application/octet-stream',
    },
    rawBody: blob,
  })
}

/** Finalize a session — resolves when the driver upload finished. */
export function multipartComplete(uploadId: string): Promise<MultipartSnapshot> {
  return request('/api/fs/multipart/complete', {
    method: 'POST',
    headers: { 'X-Upload-Id': uploadId },
  })
}

/** Abort and discard a session. */
export function multipartAbort(uploadId: string): Promise<unknown> {
  return request('/api/fs/multipart/abort', {
    method: 'POST',
    headers: { 'X-Upload-Id': uploadId },
  })
}

/**
 * High-level multipart upload with per-chunk retries, skipping chunks the
 * server already holds (resume). `onProgress` reports 0..100.
 */
export async function uploadMultipart(
  dir: string,
  relPath: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const snap = await multipartInit(dir, relPath, file)
  const chunkSize = snap.chunk_size
  const total = snap.total_chunks

  const doneSet = new Set<number>()
  for (const [a, b] of snap.received ?? []) {
    for (let i = a; i <= b; i++) doneSet.add(i)
  }
  let doneBytes = snap.received_bytes > 0 ? snap.received_bytes : doneSet.size * chunkSize

  const report = () => {
    if (onProgress) onProgress(Math.min(99, Math.round((doneBytes / file.size) * 100)))
  }
  report()

  for (let i = 0; i < total; i++) {
    if (doneSet.has(i)) continue
    const start = i * chunkSize
    const end = Math.min(file.size, start + chunkSize)
    const blob = file.slice(start, end)

    let lastErr: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await multipartChunk(snap.upload_id, i, blob)
        lastErr = null
        break
      } catch (e) {
        lastErr = e
        // transient flow-control / conflict / network — back off and retry
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }
    }
    if (lastErr) {
      throw lastErr instanceof Error ? lastErr : new Error('分片上传失败')
    }
    doneBytes = Math.min(file.size, doneBytes + (end - start))
    report()
  }

  await multipartComplete(snap.upload_id)
  onProgress?.(100)
}

/** Raw fetch for chunk bodies — exported for tests. */
export function chunkFetch(url: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken()
  return fetch(basePath() + url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...(token ? { Authorization: token } : {}) },
  })
}
