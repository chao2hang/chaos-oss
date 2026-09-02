import { request } from './client'
import type { Obj } from './types'

/** Archive tree node (fs.ArchiveMeta → content). */
export interface ArchiveContent {
  name: string
  size: number
  is_dir: boolean
  level?: number
  modified?: string
  children?: ArchiveContent[]
}

export interface ArchiveMetaResp {
  comment: string
  encrypted: boolean
  content: ArchiveContent[]
  raw_url: string
  sign: string
}

/** Read an archive's meta (tree + base extract URL + sign). */
export function archiveMeta(path: string, archivePass = '', refresh = false) {
  return request<ArchiveMetaResp>('/api/fs/archive/meta', {
    method: 'POST',
    body: { path, password: '', refresh, archive_pass: archivePass },
  })
}

export interface ArchivePage {
  content: Obj[]
  total: number
}

/** List one directory INSIDE an archive. */
export function archiveList(
  path: string,
  innerPath: string,
  archivePass = '',
  page = 1,
  perPage = 0,
  refresh = false,
) {
  return request<ArchivePage>('/api/fs/archive/list', {
    method: 'POST',
    body: {
      path,
      password: '',
      refresh,
      archive_pass: archivePass,
      inner_path: innerPath,
      page,
      per_page: perPage,
    },
  })
}

/** Extract archives into a destination directory (creates a task). */
export function archiveDecompress(
  srcDir: string,
  dstDir: string,
  names: string[],
  opts: { archivePass?: string; innerPath?: string; putIntoNewDir?: boolean; overwrite?: boolean; cacheFull?: boolean } = {},
) {
  return request<unknown>('/api/fs/archive/decompress', {
    method: 'POST',
    body: {
      src_dir: srcDir,
      dst_dir: dstDir,
      name: names,
      archive_pass: opts.archivePass ?? '',
      inner_path: opts.innerPath ?? '/',
      put_into_new_dir: opts.putIntoNewDir ?? false,
      overwrite: opts.overwrite ?? false,
      cache_full: opts.cacheFull ?? false,
    },
  })
}

/** File extensions the archive tooling understands. */
export function archiveExtensions() {
  return request<string[]>('/api/public/archive_extensions')
}

/** Direct extract link for an inner archive object. */
export function archiveExtractUrl(meta: ArchiveMetaResp, innerPath: string, archivePass = ''): string {
  const sep = meta.raw_url.includes('?') ? '&' : '?'
  const p = archivePass ? `&pass=${encodeURIComponent(archivePass)}` : ''
  const sign = meta.sign ? `sign=${encodeURIComponent(meta.sign)}` : ''
  const inner = `inner=${encodeURIComponent(innerPath)}`
  const qs = [sign, inner].filter(Boolean).join('&')
  return `${meta.raw_url}${sep}${qs}${p}`
}
