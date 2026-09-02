import { request } from './client'

/** Task categories exposed by the backend (server/router.go SetupTaskRoute). */
export const TASK_TYPES = [
  'upload',
  'copy',
  'move',
  'offline_download',
  'offline_download_transfer',
  'decompress',
  'decompress_upload',
] as const

export type TaskType = (typeof TASK_TYPES)[number]

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  upload: '上传',
  copy: '复制',
  move: '移动',
  offline_download: '离线下载',
  offline_download_transfer: '离线下载转存',
  decompress: '解压',
  decompress_upload: '解压上传',
}

export interface TaskInfo {
  id: string
  name: string
  creator: string
  creator_role: number
  /** tache state enum: 0 pending, 1 running, 2 succeeded, 3 canceling, 4 canceled,
   * 5 errored, 6 failing, 7 failed, 8 waiting_retry, 9 before_retry */
  state: number
  status: string
  progress: number
  start_time: string | null
  end_time: string | null
  total_bytes: number
  error: string
}

/** Fetch the pending/running task list of one type. */
export function taskListUndone(type: TaskType) {
  return request<TaskInfo[]>(`/api/task/${type}/undone`)
}

/** Fetch the finished (succeeded/failed/canceled) task list of one type. */
export function taskListDone(type: TaskType) {
  return request<TaskInfo[]>(`/api/task/${type}/done`)
}

export function taskCancel(type: TaskType, tid: string) {
  return request<unknown>(`/api/task/${type}/cancel`, {
    method: 'POST',
    query: { tid },
  })
}

export function taskDelete(type: TaskType, tid: string) {
  return request<unknown>(`/api/task/${type}/delete`, {
    method: 'POST',
    query: { tid },
  })
}

export function taskRetry(type: TaskType, tid: string) {
  return request<unknown>(`/api/task/${type}/retry`, {
    method: 'POST',
    query: { tid },
  })
}

export function taskClearDone(type: TaskType) {
  return request<unknown>(`/api/task/${type}/clear_done`, { method: 'POST' })
}

export function taskRetryFailed(type: TaskType) {
  return request<unknown>(`/api/task/${type}/retry_failed`, { method: 'POST' })
}

/* ----------------------------- offline download -------------------------- */

export function offlineDownloadTools() {
  return request<string[]>('/api/public/offline_download_tools')
}

export const DELETE_POLICIES = [
  { value: 'delete_on_upload_succeed', label: '上传成功后删除' },
  { value: 'delete_on_upload_failed', label: '上传失败后删除' },
  { value: 'delete_never', label: '永不删除' },
  { value: 'delete_always', label: '总是删除' },
] as const

/** Submit URLs for offline download into a directory. */
export function fsAddOfflineDownload(
  path: string,
  urls: string[],
  tool: string,
  deletePolicy: string,
) {
  return request<unknown>('/api/fs/add_offline_download', {
    method: 'POST',
    body: { urls, path, tool, delete_policy: deletePolicy },
  })
}

/* ------------------------------ torrent ------------------------------ */

export interface TorrentFileInfo {
  path: string
  size: number
}

export interface ParsedTorrent {
  name: string
  total_size: number
  piece_length: number
  piece_count: number
  info_hash: string
  files: TorrentFileInfo[]
}

/** Parse a .torrent file (multipart field "torrent"). */
export async function uploadTorrentParse(file: File): Promise<ParsedTorrent> {
  const r = await request<{ info: ParsedTorrent }>('/api/fs/torrent/upload_parse', {
    method: 'POST',
    rawBody: (() => {
      const form = new FormData()
      form.append('torrent', file, file.name)
      return form
    })(),
  })
  return r.info
}

/** Magnet link for a parsed torrent. */
export function torrentMagnet(infoHash: string, name: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`
}
