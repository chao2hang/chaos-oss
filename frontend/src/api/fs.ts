import { request, basePath, getAccessToken } from './client'
import { joinPath } from '../lib/format'
import type { FsListResp, Obj } from './types'

export interface ListParams {
  path: string
  page?: number
  perPage?: number
  refresh?: boolean
  password?: string
}

export function fsList(params: ListParams) {
  return request<FsListResp>('/api/fs/list', {
    method: 'POST',
    body: {
      path: params.path,
      page: params.page ?? 1,
      per_page: params.perPage ?? 0,
      refresh: params.refresh ?? false,
      password: params.password ?? '',
    },
  })
}

export interface FsGetResp extends Obj {
  related_objects?: unknown[]
  provider?: string
}

export function fsGet(path: string, password?: string) {
  return request<FsGetResp>('/api/fs/get', {
    method: 'POST',
    body: { path, password: password ?? '' },
  })
}

export function fsMkdir(path: string) {
  return request<never>('/api/fs/mkdir', { method: 'POST', body: { path } })
}

/** Rename an object — `path` is the full path of the object, `name` the new name. */
export function fsRename(path: string, name: string) {
  return request<never>('/api/fs/rename', {
    method: 'POST',
    body: { path, name },
  })
}

export function fsRemove(dir: string, names: string[]) {
  return request<never>('/api/fs/remove', {
    method: 'POST',
    body: { dir: dir, names },
  })
}

export function fsMove(srcDir: string, dstDir: string, names: string[]) {
  return request<never>('/api/fs/move', {
    method: 'POST',
    body: { src_dir: srcDir, dst_dir: dstDir, names },
  })
}

export function fsCopy(srcDir: string, dstDir: string, names: string[]) {
  return request<never>('/api/fs/copy', {
    method: 'POST',
    body: { src_dir: srcDir, dst_dir: dstDir, names },
  })
}

/** Upload one file into `dir` via PUT /api/fs/form (multipart).
 * `relPath` may contain sub-directories ("sub/a.txt") for folder uploads —
 * parents must already exist (mkdir them first). */
export function fsUpload(
  dir: string,
  relPath: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${basePath()}/api/fs/form`)
    // File-Path is the URL-encoded full target path (dir + relative path)
    xhr.setRequestHeader('File-Path', encodeURIComponent(joinPath(dir, relPath)))
    xhr.setRequestHeader('As-Task', 'false')
    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', token)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText)
          if (body.code === 200) return resolve()
          reject(new Error(body.message || '上传失败'))
        } catch {
          reject(new Error(`上传失败 (${xhr.status})`))
        }
      } else {
        reject(new Error(`上传失败 (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error('网络错误'))
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

/* ------------------------------ batch/regex rename ------------------------------ */

/** Rename several files in one request. */
export function fsBatchRename(
  srcDir: string,
  objects: { src_name: string; new_name: string }[],
) {
  return request<unknown>('/api/fs/batch_rename', {
    method: 'POST',
    body: { src_dir: srcDir, rename_objects: objects },
  })
}

/** Rename all files matching a Go regex. Replacement supports $1, $2... */
export function fsRegexRename(srcDir: string, srcRegex: string, newRegex: string) {
  return request<unknown>('/api/fs/regex_rename', {
    method: 'POST',
    body: { src_dir: srcDir, src_name_regex: srcRegex, new_name_regex: newRegex },
  })
}
