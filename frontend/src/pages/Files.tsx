import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  EmptyState,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogBody,
  Input,
  Textarea,
  NativeSelect,
} from '@chaos_team/chaos-ui'
import {
  RefreshCwIcon,
  DownloadIcon,
  FolderIcon,
  UploadIcon,
  FolderPlusIcon,
  FolderUpIcon,
  CircleCheckIcon,
  CircleAlertIcon,
  PencilIcon,
  Trash2Icon,
  FolderInputIcon,
  CopyIcon,
  LinkIcon,
  EyeIcon,
  ListChecksIcon,
  LockIcon,
  UploadCloudIcon,
  FileVideoIcon,
  LayoutGridIcon,
  ListIcon,
  ReplaceIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowUpDownIcon,
  CloudDownloadIcon,
  Share2Icon,
  SearchIcon,
  FolderCogIcon,
} from 'lucide-react'
import { fsList, fsGet, fsUpload, fsMkdir, fsRename, fsRemove, fsMove, fsCopy, fsBatchRename, fsRegexRename } from '../api/fs'
import { uploadMultipart } from '../api/multipart'
import { getPublicSettings } from '../api/public'
import { archiveExtensions } from '../api/archive'
import { fsSearch } from '../api/search'
import {
  fsAddOfflineDownload,
  offlineDownloadTools,
  DELETE_POLICIES,
  uploadTorrentParse,
  torrentMagnet,
  type ParsedTorrent,
} from '../api/task'
import { downloadUrl } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useI18n } from '../i18n'
import { formatBytes, formatTime, joinPath, pathSegments } from '../lib/format'
import { parsePreviewSettings, matchPreview } from '../lib/preview'
import { FileIconCell } from '../components/FileIconCell'
import { RenameDialog, MoveCopyDialog, RegexRenameDialog, BatchRenameDialog } from '../components/FileActionDialogs'
import { ShareDialog } from '../components/ShareDialog'
import MetaDialog from '../components/MetaDialog'
import Markdown from '../components/Markdown'
import TopBar from '../components/TopBar'
import type { Obj } from '../api/types'

const PER_PAGE = 100

/** Map the URL to a storage path: /files/docs/x → /docs/x. */
function storagePath(urlPath: string): string {
  const p = decodeURIComponent(urlPath).replace(/^\/files/, '')
  return p === '' ? '/' : p
}

interface UploadTask {
  id: number
  name: string
  percent: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

interface CtxMenuState {
  x: number
  y: number
  obj: Obj | null // null = empty-area menu
}

interface CtxItem {
  key: string
  label: string
  icon?: React.ReactNode
  danger?: boolean
  separator?: boolean
  disabled?: boolean
  onClick?: () => void
}

type SortKey = 'name' | 'size' | 'modified'

export default function Files() {
  const nav = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const path = storagePath(location.pathname)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const [uploads, setUploads] = useState<UploadTask[]>([])
  const [uploadsVisible, setUploadsVisible] = useState(false)
  const [mkdirOpen, setMkdirOpen] = useState(false)
  const [mkdirName, setMkdirName] = useState('')
  const [renameTarget, setRenameTarget] = useState<Obj | null>(null)
  const [moveCopy, setMoveCopy] = useState<{ mode: 'move' | 'copy'; names: string[] } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null)
  /** path whose metadata is being edited (admin only) */
  const [metaTarget, setMetaTarget] = useState<string | null>(null)
  const [shareFiles, setShareFiles] = useState<string[] | null>(null)

  // regex / batch rename dialogs
  const [regexOpen, setRegexOpen] = useState(false)
  const [batchRenameOpen, setBatchRenameOpen] = useState(false)

  // drag & drop upload
  const [dragOver, setDragOver] = useState(false)

  // grid / list view — persisted per browser
  const [view, setView] = useState<'list' | 'grid'>(() =>
    localStorage.getItem('chaos-view') === 'grid' ? 'grid' : 'list',
  )
  const switchView = (v: 'list' | 'grid') => {
    setView(v)
    localStorage.setItem('chaos-view', v)
  }

  // offline download dialog
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [offlineUrls, setOfflineUrls] = useState('')
  const [offlineTool, setOfflineTool] = useState('')
  const [offlinePolicy, setOfflinePolicy] = useState('delete_on_upload_succeed')
  const [offlineBusy, setOfflineBusy] = useState(false)
  const [torrentInfo, setTorrentInfo] = useState<ParsedTorrent | null>(null)
  const torrentInputRef = useRef<HTMLInputElement>(null)

  const offlineTools = useQuery({
    queryKey: ['public', 'offline-tools'],
    queryFn: offlineDownloadTools,
    enabled: offlineOpen,
    staleTime: 60_000,
  })

  // pagination / sorting / batch selection
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)

  // reset view state when navigating to another directory
  useEffect(() => {
    setPage(1)
    setSelection(new Set())
    setSelectMode(false)
    setDirPwd('')
    setPwdInput('')
  }, [path])

  // meta-protected directory: current password attempt (state resets per path)
  const [dirPwd, setDirPwd] = useState('')
  const [pwdInput, setPwdInput] = useState('')

  const list = useQuery({
    queryKey: ['fs', 'list', path, page, dirPwd],
    queryFn: () => fsList({ path, refresh: false, page, perPage: PER_PAGE, password: dirPwd }),
    retry: false,
  })
  const pwdNeeded = list.isError && list.error?.message.toLowerCase().includes('password')
  const canWrite = !!list.data?.write
  /** share permission: admins always, users via permission bit 14 */
  const canShare = !!user && (user.role === 2 || ((user.permission >> 14) & 1) === 1)

  // preview configuration from the public site settings (shared with /preview)
  const pubSettings = useQuery({
    queryKey: ['public', 'settings'],
    queryFn: getPublicSettings,
    staleTime: 300_000,
  })
  const ps = pubSettings.data ? parsePreviewSettings(pubSettings.data) : null
  const isPreviewable = (obj: Obj) => !!ps && !!matchPreview(obj.name, ps)

  // archive extensions (for routing archive files to the archive browser) —
  // the API returns dot-prefixed suffixes like ".zip", ".7z.001"
  const archiveExts = useQuery({
    queryKey: ['public', 'archive-exts'],
    queryFn: archiveExtensions,
    staleTime: 300_000,
  })
  const isArchiveName = (name: string) =>
    (archiveExts.data ?? []).some((e) => name.toLowerCase().endsWith(e))

  // search state — replaces the list content while active
  const [searchText, setSearchText] = useState('')
  const searching = searchText.trim().length > 0

  const segments = useMemo(() => pathSegments(path), [path])

  const onLogout = async () => {
    await logout()
    message.success(t('已退出'))
  }

  const content = list.data?.content ?? []
  const total = list.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  // client-side sort — directories always first
  const sorted = useMemo(() => {
    const arr = [...content]
    arr.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true })
      } else if (sortKey === 'size') {
        cmp = a.size - b.size
      } else {
        cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime()
      }
      return sortAsc ? cmp : -cmp
    })
    return arr
  }, [content, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  // ---------------------------------------------------------------- selection

  const selNames = useMemo(() => [...selection], [selection])
  const allSelected = content.length > 0 && content.every((o) => selection.has(o.name))
  const toggleSel = (name: string) =>
    setSelection((prev) => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  const toggleAll = () =>
    setSelection(allSelected ? new Set() : new Set(content.map((o) => o.name)))
  const clearSelection = () => {
    setSelection(new Set())
    setSelectMode(false)
  }

  const batchDelete = async () => {
    if (!confirm(t('删除选中的 {n} 项？', { n: selNames.length }))) return
    try {
      await fsRemove(path, selNames)
      message.success(t('已删除 {n} 项', { n: selNames.length }))
      clearSelection()
      refreshList()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('删除失败'))
    }
  }

  const navigateTo = (p: string) => nav(`/files${p === '/' ? '' : p}`)

  /** Open any full storage path (used by list rows and search results). */
  const openPath = (fullPath: string, isDir: boolean, name: string) => {
    if (isDir) {
      navigateTo(fullPath)
      return
    }
    if (isArchiveName(name)) {
      nav(`/archive?p=${encodeURIComponent(fullPath)}`)
      return
    }
    if (ps && matchPreview(name, ps)) {
      nav(`/preview?p=${encodeURIComponent(fullPath)}`)
      return
    }
    // download needs a sign — resolve it first
    fsGet(fullPath)
      .then((info) => window.open(downloadUrl(fullPath, info.sign), '_blank'))
      .catch((e) => message.error(e instanceof Error ? e.message : t('打开失败')))
  }

  /** Click a file: preview when configured, download otherwise. */
  const openObj = (obj: Obj) => openPath(joinPath(path, obj.name), obj.is_dir, obj.name)

  const search = useQuery({
    queryKey: ['fs', 'search', path, searchText.trim()],
    queryFn: () => fsSearch(path, searchText.trim()),
    enabled: searching,
    retry: false,
  })

  const refreshList = () => {
    qc.invalidateQueries({ queryKey: ['fs', 'list', path] })
  }

  // ---------------------------------------------------------------- context menu

  const openCtxMenu = (e: React.MouseEvent, obj: Obj | null) => {
    e.preventDefault()
    if (obj) e.stopPropagation() // rows win over the empty-area menu
    setCtxMenu({ x: e.clientX, y: e.clientY, obj })
  }

  // close on outside click / escape / scroll / resize
  useEffect(() => {
    if (!ctxMenu) return
    const onDown = (ev: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(ev.target as Node)) {
        setCtxMenu(null)
      }
    }
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && setCtxMenu(null)
    const close = () => setCtxMenu(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [ctxMenu])

  // ---------------------------------------------------------------- actions

  const copyLink = async (obj: Obj) => {
    const url =
      window.location.origin + downloadUrl(joinPath(path, obj.name), obj.sign)
    try {
      await navigator.clipboard.writeText(url)
      message.success(t('链接已复制'))
    } catch {
      message.error(t('复制失败'))
    }
  }

  const doRename = async (newName: string) => {
    if (!renameTarget) return
    await fsRename(joinPath(path, renameTarget.name), newName)
    message.success(t('已重命名'))
    refreshList()
  }

  const doDelete = async (obj: Obj) => {
    const kind = obj.is_dir ? t('文件夹') : t('文件')
    if (!confirm(t('删除{kind} {name}？', { kind, name: obj.name }))) return
    try {
      await fsRemove(path, [obj.name])
      message.success(t('已删除'))
      refreshList()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('删除失败'))
    }
  }

  const doMoveCopy = async (dstDir: string) => {
    if (!moveCopy) return
    const { mode, names } = moveCopy
    if (mode === 'move') await fsMove(path, dstDir, names)
    else await fsCopy(path, dstDir, names)
    message.success(mode === 'move' ? t('已移动') : t('已复制'))
    clearSelection()
    refreshList()
  }

  const ctxItems = (state: CtxMenuState): CtxItem[] => {
    const run = (fn: () => void) => () => {
      setCtxMenu(null)
      fn()
    }
    if (state.obj) {
      const obj = state.obj
      const download = () =>
        window.open(downloadUrl(joinPath(path, obj.name), obj.sign), '_blank')
      const items: CtxItem[] = []
      if (!obj.is_dir && isPreviewable(obj)) {
        items.push({
          key: 'preview',
          label: t('预览'),
          icon: <EyeIcon className="h-4 w-4" />,
          onClick: run(() => openObj(obj)),
        })
      }
      items.push({
        key: 'open',
        label: obj.is_dir ? t('打开') : t('下载'),
        icon: <DownloadIcon className="h-4 w-4" />,
        onClick: run(() => (obj.is_dir ? openObj(obj) : download())),
      })
      if (!obj.is_dir) {
        items.push({
          key: 'link',
          label: t('复制链接'),
          icon: <LinkIcon className="h-4 w-4" />,
          onClick: run(() => copyLink(obj)),
        })
      }
      if (canShare) {
        items.push({
          key: 'share',
          label: t('分享…'),
          icon: <Share2Icon className="h-4 w-4" />,
          onClick: run(() => setShareFiles([joinPath(path, obj.name)])),
        })
      }
      if (user?.role === 2) {
        items.push({
          key: 'meta',
          label: t('元数据…'),
          icon: <FolderCogIcon className="h-4 w-4" />,
          onClick: run(() => setMetaTarget(joinPath(path, obj.name))),
        })
      }
      if (canWrite) {
        items.push(
          { key: 'sep1', label: '', separator: true },
          { key: 'rename', label: t('重命名'), icon: <PencilIcon className="h-4 w-4" />, onClick: run(() => setRenameTarget(obj)) },
          { key: 'move', label: t('移动到…'), icon: <FolderInputIcon className="h-4 w-4" />, onClick: run(() => setMoveCopy({ mode: 'move', names: [obj.name] })) },
          { key: 'copy', label: t('复制到…'), icon: <CopyIcon className="h-4 w-4" />, onClick: run(() => setMoveCopy({ mode: 'copy', names: [obj.name] })) },
          { key: 'sep2', label: '', separator: true },
          { key: 'delete', label: t('删除'), icon: <Trash2Icon className="h-4 w-4" />, danger: true, onClick: run(() => doDelete(obj)) },
        )
      }
      return items
    }
    // empty-area menu
    const items: CtxItem[] = []
    if (canWrite) {
      items.push(
        { key: 'up', label: t('上传文件'), icon: <UploadIcon className="h-4 w-4" />, onClick: run(() => fileInputRef.current?.click()) },
        { key: 'updir', label: t('上传文件夹'), icon: <FolderUpIcon className="h-4 w-4" />, onClick: run(() => folderInputRef.current?.click()) },
        { key: 'mkdir', label: t('新建文件夹'), icon: <FolderPlusIcon className="h-4 w-4" />, onClick: run(() => setMkdirOpen(true)) },
        { key: 'offline', label: t('离线下载'), icon: <CloudDownloadIcon className="h-4 w-4" />, onClick: run(() => setOfflineOpen(true)) },
        { key: 'regex', label: t('正则重命名…'), icon: <ReplaceIcon className="h-4 w-4" />, onClick: run(() => setRegexOpen(true)) },
        { key: 'sep', label: '', separator: true },
      )
    }
    if (user?.role === 2) {
      items.push({
        key: 'meta',
        label: t('本目录元数据…'),
        icon: <FolderCogIcon className="h-4 w-4" />,
        onClick: run(() => setMetaTarget(path)),
      })
    }
    items.push(
      {
        key: 'select',
        label: selectMode ? t('退出选择') : t('多选'),
        icon: <ListChecksIcon className="h-4 w-4" />,
        onClick: run(() => {
          setSelectMode((v) => !v)
          setSelection(new Set())
        }),
      },
      {
        key: 'refresh',
        label: t('刷新'),
        icon: <RefreshCwIcon className="h-4 w-4" />,
        onClick: run(() => list.refetch()),
      },
    )
    return items
  }

  // ---------------------------------------------------------------- uploads

  /** files above this size go through the chunked/multipart pipeline */
  const MULTIPART_THRESHOLD = 8 * 1024 * 1024

  const startUpload = async (files: File[], folderMode: boolean) => {
    if (files.length === 0) return
    const tasks: { relPath: string; file: File }[] = files.map((f) => ({
      relPath: folderMode && f.webkitRelativePath ? f.webkitRelativePath : f.name,
      file: f,
    }))

    // folder uploads: make sure every parent directory exists first
    if (folderMode) {
      const dirs = new Set<string>()
      for (const t of tasks) {
        const parts = t.relPath.split('/')
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join('/'))
        }
      }
      for (const d of dirs) {
        try {
          await fsMkdir(joinPath(path, d))
        } catch {
          // already exists — fine
        }
      }
    }

    setUploadsVisible(true)
    const batch: UploadTask[] = tasks.map((t, i) => ({
      id: Date.now() + i,
      name: t.relPath,
      percent: 0,
      status: 'uploading',
    }))
    setUploads((prev) => [...prev, ...batch])

    let failed = 0
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      const id = batch[i].id
      try {
        const upload =
          task.file.size > MULTIPART_THRESHOLD
            ? uploadMultipart(path, task.relPath, task.file, (percent) => {
                setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, percent } : u)))
              })
            : fsUpload(path, task.relPath, task.file, (percent) => {
                setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, percent } : u)))
              })
        await upload
        setUploads((prev) =>
          prev.map((u) => (u.id === id ? { ...u, status: 'done', percent: 100 } : u)),
        )
      } catch (e) {
        failed++
        setUploads((prev) =>
          prev.map((u) =>
            u.id === id
              ? { ...u, status: 'error', error: e instanceof Error ? e.message : t('上传失败') }
              : u,
          ),
        )
      }
    }

    if (failed === 0) message.success(t('已上传 {n} 个文件', { n: tasks.length }))
    else message.error(t('{n} 个文件上传失败', { n: failed }))
    refreshList()
  }

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>, folderMode: boolean) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-picking the same file
    startUpload(files, folderMode)
  }

  // ---------------------------------------------------------------- drag & drop upload

  /** Collect dropped files (and folders, recursively) from a drop event. */
  const filesFromDrop = async (dt: DataTransfer): Promise<File[]> => {
    const items = Array.from(dt.items ?? [])
    const entries = items
      .map((it) => (it.kind === 'file' ? it.webkitGetAsEntry() : null))
      .filter(Boolean) as FileSystemEntry[]
    if (entries.length === 0) return Array.from(dt.files ?? [])

    const out: File[] = []
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const file = await new Promise<File | null>((res) =>
          (entry as FileSystemFileEntry).file(res, () => res(null)),
        )
        if (file) {
          // keep the relative path for folder drops
          Object.defineProperty(file, 'webkitRelativePath', {
            value: prefix + file.name,
            configurable: true,
          })
          out.push(file)
        }
      } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        // readEntries returns at most 100 entries per call — loop until empty
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((res) =>
            reader.readEntries(res, () => res([])),
          )
          if (batch.length === 0) break
          for (const e of batch) await walk(e, `${prefix}${entry.name}/`)
        }
      }
    }
    for (const e of entries) await walk(e, '')
    return out
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (!canWrite) return
    const files = await filesFromDrop(e.dataTransfer)
    const folderMode = files.some((f) => f.webkitRelativePath)
    startUpload(files, folderMode)
  }

  const doneCount = uploads.filter((u) => u.status !== 'uploading').length
  const allDone = uploads.length > 0 && doneCount === uploads.length

  // ---------------------------------------------------------------- offline download

  const submitOffline = async () => {
    const urls = offlineUrls
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (urls.length === 0) return
    setOfflineBusy(true)
    try {
      await fsAddOfflineDownload(path, urls, offlineTool, offlinePolicy)
      message.success(t('已添加 {n} 个离线下载任务', { n: urls.length }))
      setOfflineOpen(false)
      setOfflineUrls('')
      refreshList()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('添加失败'))
    } finally {
      setOfflineBusy(false)
    }
  }

  /** Parse a picked .torrent file for offline download. */
  const onTorrentPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const info = await uploadTorrentParse(f)
      setTorrentInfo(info)
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('解析种子失败'))
    }
  }

  /** Submit the parsed torrent as a magnet offline download task. */
  const submitTorrent = async () => {
    if (!torrentInfo) return
    setOfflineBusy(true)
    try {
      const magnet = torrentMagnet(torrentInfo.info_hash, torrentInfo.name)
      await fsAddOfflineDownload(path, [magnet], offlineTool, offlinePolicy)
      message.success(t('已添加种子任务：{name}', { name: torrentInfo.name }))
      setOfflineOpen(false)
      setTorrentInfo(null)
      refreshList()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('添加失败'))
    } finally {
      setOfflineBusy(false)
    }
  }

  // ---------------------------------------------------------------- mkdir

  const submitMkdir = async () => {
    const name = mkdirName.trim()
    if (!name) return
    try {
      await fsMkdir(joinPath(path, name))
      message.success(t('已创建 {name}', { name }))
      setMkdirOpen(false)
      setMkdirName('')
      refreshList()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('创建失败'))
    }
  }

  // ---------------------------------------------------------------- render

  const rowProps = (obj: Obj) => ({
    onContextMenu: (e: React.MouseEvent) => openCtxMenu(e, obj),
  })

  const checkbox = (name: string, className = '') => (
    <input
      type="checkbox"
      checked={selection.has(name)}
      onClick={(e) => e.stopPropagation()}
      onChange={() => toggleSel(name)}
      aria-label={t('选择 {name}', { name })}
      className={`h-4 w-4 shrink-0 cursor-pointer accent-[#6b88ff] ${className}`}
    />
  )

  const sortLabel: Record<SortKey, string> = { name: t('名称'), size: t('大小'), modified: t('时间') }

  return (
    <div className="min-h-screen bg-background">
      <TopBar username={user?.username} isAdmin={user?.role === 2} onLogout={onLogout} />

      <main
        className="relative mx-auto max-w-5xl px-4 pb-16 sm:px-6"
        onDragOver={(e) => {
          e.preventDefault()
          if (canWrite) setDragOver(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDragOver(false)
        }}
        onDrop={onDrop}
      >
        {/* drag & drop overlay */}
        {dragOver && canWrite && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary/10 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 text-primary">
              <UploadCloudIcon className="h-10 w-10" />
              <p className="text-sm font-medium">{t('松开以上传到当前目录')}</p>
            </div>
          </div>
        )}
        {/* breadcrumb + actions */}
        <div className="flex items-center justify-between gap-4 py-4">
          <Breadcrumb>
            <BreadcrumbList>
              {segments.map((seg, i) => (
                <span key={seg.path} className="flex items-center">
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      className="cursor-pointer"
                      onClick={() => navigateTo(seg.path)}
                    >
                      {seg.name}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex shrink-0 items-center gap-1">
            <div className="relative hidden sm:block">
              <SearchIcon className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("搜索此目录…")}
                className="h-8 w-40 rounded-sm border border-border bg-card pl-7 pr-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary sm:w-48"
              />
              {searching && (
                <button
                  aria-label={t("清除搜索")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchText('')}
                >
                  <XIcon className="h-3 w-3" />
                </button>
              )}
            </div>
            {content.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  title={view === 'grid' ? t('列表视图') : t('网格视图')}
                  aria-label={t("切换视图")}
                  onClick={() => switchView(view === 'grid' ? 'list' : 'grid')}
                >
                  {view === 'grid' ? (
                    <ListIcon className="h-4 w-4" />
                  ) : (
                    <LayoutGridIcon className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title={selectMode ? t('退出多选') : t('多选')}
                  aria-label={t("多选")}
                onClick={() => {
                  setSelectMode((v) => !v)
                  setSelection(new Set())
                }}
              >
                  <ListChecksIcon className={`h-4 w-4 ${selectMode ? 'text-primary' : ''}`} />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              disabled={list.isFetching}
              onClick={() => list.refetch()}
              title={t("刷新")}
            >
              <RefreshCwIcon
                className={`h-4 w-4 ${list.isFetching ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </div>

        {/* header from meta */}
        {list.data?.header && (
          <div className="mb-3 rounded-md border border-border bg-card p-4">
            <Markdown>{list.data.header}</Markdown>
          </div>
        )}

        {/* path actions (upload / new folder) — only when the path is writable */}
        {canWrite && !selectMode && !searching && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon className="mr-1.5 h-3.5 w-3.5" />
              {t('上传文件')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => folderInputRef.current?.click()}>
              <FolderUpIcon className="mr-1.5 h-3.5 w-3.5" />
              {t('上传文件夹')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMkdirOpen(true)}>
              <FolderPlusIcon className="mr-1.5 h-3.5 w-3.5" />
              {t('新建文件夹')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOfflineOpen(true)}>
              <CloudDownloadIcon className="mr-1.5 h-3.5 w-3.5" />
              {t('离线下载')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => onFilePicked(e, false)}
            />
            <input
              ref={folderInputRef}
              type="file"
              hidden
              multiple
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => onFilePicked(e, true)}
            />
          </div>
        )}

        {/* error state (no storage mounted, permission, ...) */}
        {list.isError && !pwdNeeded && (
          <div className="rounded-md border border-border bg-card p-4">
            <EmptyState
              title={t("无法加载目录")}
              description={list.error instanceof Error ? list.error.message : ''}
              action={
                <Button variant="outline" onClick={() => list.refetch()}>
                  {t('重试')}
                </Button>
              }
            />
          </div>
        )}

        {/* meta-protected directory: password unlock */}
        {pwdNeeded && (
          <div className="rounded-md border border-border bg-card p-4">
            <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
              <LockIcon className="h-8 w-8 text-primary" />
              <p className="text-sm">{t('此目录需要密码')}</p>
              <div className="flex w-full gap-2">
                <Input
                  type="password"
                  autoFocus
                  value={pwdInput}
                  onChange={(e) => setPwdInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setDirPwd(pwdInput)}
                  placeholder={t("目录密码")}
                />
                <Button size="sm" onClick={() => setDirPwd(pwdInput)}>
                  {t('解锁')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* loading skeleton */}
        {!list.isError && list.isLoading && (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border-b border-border last:border-b-0">
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Skeleton className="h-5 w-5 rounded-sm" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* empty state */}
        {!searching && !list.isError && !list.isLoading && sorted.length === 0 && (
          <div
            className="overflow-hidden rounded-md border border-border bg-card"
            onContextMenu={(e) => openCtxMenu(e, null)}
          >
            <EmptyState
              icon={FolderIcon}
              title={t("目录为空")}
              description={canWrite ? t('右键或使用上方按钮上传文件、新建文件夹') : t('这里还没有任何文件')}
            />
          </div>
        )}

        {/* search results replace the file list */}
        {searching && (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            {search.isLoading ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-2/3" />
                ))}
              </div>
            ) : search.isError ? (
              <EmptyState
                variant="error"
                title={t("搜索失败")}
                description={search.error instanceof Error ? search.error.message : ''}
              />
            ) : (search.data?.content ?? []).length === 0 ? (
              <EmptyState title={t('没有匹配“{q}”的结果', { q: searchText.trim() })} description={t('如果从未构建过索引，请先在 设置 → 索引 中构建')} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[44%]">{t('名称')}</TableHead>
                    <TableHead className="w-[14%]">{t('大小')}</TableHead>
                    <TableHead className="w-[42%]">{t('位置')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(search.data?.content ?? []).map((node) => (
                    <TableRow
                      key={`${node.parent}/${node.name}`}
                      className="cursor-pointer"
                      onClick={() => openPath(joinPath(node.parent, node.name), node.is_dir, node.name)}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2 truncate">
                          <FileIconCell obj={{ name: node.name, is_dir: node.is_dir, size: node.size, type: node.type, modified: '' }} />
                          <span className="truncate">{node.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {node.is_dir ? '-' : formatBytes(node.size)}
                      </TableCell>
                      <TableCell className="truncate text-xs text-muted-foreground" title={node.parent}>
                        {node.parent === path
                          ? '/'
                          : node.parent.startsWith(path === '/' ? '/' : path + '/')
                            ? node.parent.slice(path.length) || '/'
                            : node.parent}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        {/* grid view (both mobile & desktop) */}
        {!searching && !list.isError && !list.isLoading && sorted.length > 0 && view === 'grid' && (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            onContextMenu={(e) => openCtxMenu(e, null)}
          >
            {sorted.map((obj) => (
              <div
                key={obj.name}
                className={`group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-md border p-3 transition-colors ${
                  selection.has(obj.name)
                    ? 'border-primary bg-muted/70'
                    : 'border-border bg-card hover:bg-muted/70'
                }`}
                onClick={() => (selectMode ? toggleSel(obj.name) : openObj(obj))}
                onContextMenu={(e) => openCtxMenu(e, obj)}
              >
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={selection.has(obj.name)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleSel(obj.name)}
                    aria-label={t('选择 {name}', { name: obj.name })}
                    className="absolute left-2 top-2 h-4 w-4 accent-primary"
                  />
                )}
                <FileIconCell obj={obj} className="mt-2 h-10 w-10" />
                <p className="w-full truncate text-center text-xs text-foreground" title={obj.name}>
                  {obj.name}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {obj.is_dir ? t('文件夹') : formatBytes(obj.size)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* mobile: card list with large touch targets */}
        {!searching && !list.isError && !list.isLoading && sorted.length > 0 && view === 'list' && (
          <div
            className="overflow-hidden rounded-md border border-border bg-card md:hidden"
            onContextMenu={(e) => openCtxMenu(e, null)}
          >
            {sorted.map((obj) => (
              <div
                key={obj.name}
                role="button"
                tabIndex={0}
                {...rowProps(obj)}
                onClick={() => (selectMode ? toggleSel(obj.name) : openObj(obj))}
                onKeyDown={(e) => e.key === 'Enter' && openObj(obj)}
                className={`flex min-h-14 items-center gap-3 border-b border-border px-4 py-2.5 transition-colors last:border-b-0 ${
                  selection.has(obj.name) ? 'bg-muted/70' : 'hover:bg-muted/70 active:bg-muted'
                }`}
              >
                {selectMode && checkbox(obj.name)}
                <FileIconCell obj={obj} className="h-5 w-5" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">{obj.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {obj.is_dir ? t('文件夹') : formatBytes(obj.size)} ·{' '}
                    {formatTime(obj.modified)}
                  </div>
                </div>
                {!obj.is_dir && !selectMode && (
                  <button
                    aria-label={t('下载 {name}', { name: obj.name })}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(
                        downloadUrl(joinPath(path, obj.name), obj.sign),
                        '_blank',
                      )
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <DownloadIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* desktop: table */}
        {!searching && !list.isError && !list.isLoading && sorted.length > 0 && view === 'list' && (
          <div
            className="hidden overflow-hidden rounded-md border border-border bg-card md:block"
            onContextMenu={(e) => openCtxMenu(e, null)}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={t("全选本页")}
                      className="h-4 w-4 cursor-pointer accent-[#6b88ff]"
                    />
                  </TableHead>
                  <TableHead className="w-[48%] cursor-pointer select-none" onClick={() => toggleSort('name')}>
                    {t('名称')} {sortKey === 'name' && (sortAsc ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="w-[16%] cursor-pointer select-none" onClick={() => toggleSort('size')}>
                    {t('大小')} {sortKey === 'size' && (sortAsc ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="w-[24%] cursor-pointer select-none" onClick={() => toggleSort('modified')}>
                    {t('修改时间')} {sortKey === 'modified' && (sortAsc ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="w-[8%] text-right">{t('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((obj) => (
                  <TableRow
                    key={obj.name}
                    className={`cursor-pointer ${selection.has(obj.name) ? 'bg-muted/70' : ''}`}
                    {...rowProps(obj)}
                    onClick={() => openObj(obj)}
                  >
                    <TableCell className="pr-0">{checkbox(obj.name)}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 truncate">
                        <FileIconCell obj={obj} />
                        <span className="truncate">{obj.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {obj.is_dir ? '-' : formatBytes(obj.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatTime(obj.modified)}
                    </TableCell>
                    <TableCell className="text-right">
                      {!obj.is_dir && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(
                              downloadUrl(joinPath(path, obj.name), obj.sign),
                              '_blank',
                            )
                          }}
                          title={t("下载")}
                        >
                          <DownloadIcon className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* footer: total + mobile sort control + pagination */}
        {!searching && !list.isError && !list.isLoading && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              共 {total} 项
              {selection.size > 0 && ` · ${t('已选 {n} 项', { n: selection.size })}`}
              {totalPages > 1 && ` · ${t('第 {p}/{n} 页', { p: page, n: totalPages })}`}
            </p>
            {/* mobile sort control */}
            <div className="flex items-center gap-0.5 md:hidden">
              <ArrowUpDownIcon className="mr-1 h-3 w-3 text-muted-foreground" />
              {(Object.keys(sortLabel) as SortKey[]).map((key) => (
                <button
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`rounded-sm px-1.5 py-0.5 text-xs transition-colors ${
                    sortKey === key
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {sortLabel[key]}
                  {sortKey === key && (sortAsc ? '↑' : '↓')}
                </button>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  {t('上一页')}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('下一页')}
                  <ChevronRightIcon className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        {/* readme from meta */}
        {list.data?.readme && (
          <div className="mt-4 rounded-md border border-border bg-card p-4">
            <Markdown>{list.data.readme}</Markdown>
          </div>
        )}
      </main>

      {/* batch selection action bar */}
      {selection.size > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-40 flex items-center gap-1 rounded-md border border-border bg-card p-2 shadow-lg sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2">
          <span className="px-2 text-xs text-muted-foreground">已选 {selection.size} 项</span>
          <Button size="sm" variant="ghost" onClick={toggleAll}>
            {allSelected ? t('取消全选') : t('全选')}
          </Button>
          {canShare && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShareFiles(selNames.map((n) => joinPath(path, n)))}
            >
              <Share2Icon className="mr-1 h-3.5 w-3.5" />
              {t('分享')}
            </Button>
          )}
          {canWrite && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setBatchRenameOpen(true)}
              >
                <PencilIcon className="mr-1 h-3.5 w-3.5" />
                {t('重命名')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMoveCopy({ mode: 'move', names: selNames })}
              >
                <FolderInputIcon className="mr-1 h-3.5 w-3.5" />
                {t('移动')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMoveCopy({ mode: 'copy', names: selNames })}
              >
                <CopyIcon className="mr-1 h-3.5 w-3.5" />
                {t('复制')}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-400" onClick={batchDelete}>
                <Trash2Icon className="mr-1 h-3.5 w-3.5" />
                {t('删除')}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" aria-label={t("退出选择")} onClick={clearSelection}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* context menu (shared, positioned at cursor) */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          role="menu"
          className="fixed z-50 min-w-44 rounded-md border border-border bg-card p-1 shadow-lg"
          style={{
            left: Math.min(ctxMenu.x, window.innerWidth - 200),
            top: Math.min(ctxMenu.y, window.innerHeight - (ctxItems(ctxMenu).length * 32 + 16)),
          }}
        >
          {ctxItems(ctxMenu).map((item) =>
            item.separator ? (
              <div key={item.key} className="my-1 h-px bg-border" />
            ) : (
              <button
                key={item.key}
                type="button"
                disabled={item.disabled}
                onClick={item.onClick}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors outline-none ${
                  item.danger
                    ? 'text-red-400 hover:bg-red-400/10'
                    : 'text-[rgba(250,250,250,0.85)] hover:bg-muted hover:text-foreground'
                } ${item.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}

      {/* mkdir dialog */}
      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('新建文件夹')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              autoFocus
              placeholder={t("文件夹名称")}
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitMkdir()}
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMkdirOpen(false)}>
              {t('取消')}
            </Button>
            <Button size="sm" disabled={!mkdirName.trim()} onClick={submitMkdir}>
              {t('创建')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* share create dialog */}
      <MetaDialog
        open={!!metaTarget}
        path={metaTarget ?? ''}
        onOpenChange={(v) => !v && setMetaTarget(null)}
      />
      <ShareDialog
        open={shareFiles !== null}
        onOpenChange={(v) => !v && setShareFiles(null)}
        files={shareFiles ?? []}
      />

      {/* offline download dialog */}
      <Dialog open={offlineOpen} onOpenChange={setOfflineOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('离线下载')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="mb-3 text-xs text-muted-foreground">
              {t('下载到')} <span className="font-mono">{path}</span>
            </p>
            <Textarea
              rows={4}
              autoFocus
              placeholder={t('每行一个链接\nhttps://… 或磁力链接')}
              value={offlineUrls}
              onChange={(e) => setOfflineUrls(e.target.value)}
            />
            {/* torrent file */}
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={torrentInputRef}
                type="file"
                accept=".torrent"
                hidden
                onChange={onTorrentPicked}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => torrentInputRef.current?.click()}
              >
                <FileVideoIcon className="mr-1.5 h-3.5 w-3.5" />
                {t('解析 .torrent 文件')}
              </Button>
              {torrentInfo && (
                <button
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setTorrentInfo(null)}
                >
                  {t('清除')}
                </button>
              )}
            </div>
            {torrentInfo && (
              <div className="mt-2 rounded-md border border-border p-2 text-xs">
                <p className="font-medium">{torrentInfo.name}</p>
                <p className="text-muted-foreground">
                  {formatBytes(torrentInfo.total_size)} · {(torrentInfo.files ?? []).length} 个文件 ·
                  将转为磁力链提交
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground">{t('文件列表')}</summary>
                  <ul className="mt-1 max-h-28 overflow-y-auto font-mono text-[10px] text-muted-foreground">
                    {(torrentInfo.files ?? []).map((f) => (
                      <li key={f.path} className="truncate">
                        {f.path} ({formatBytes(f.size)})
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('工具')}</label>
                <NativeSelect
                  value={offlineTool}
                  onChange={(e) => setOfflineTool(e.target.value)}
                  options={(offlineTools.data ?? []).map((t) => ({ value: t, label: t }))}
                  placeholder={offlineTools.isLoading ? t('加载中…') : t('选择工具')}
                  className="w-full"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('删除策略')}</label>
                <NativeSelect
                  value={offlinePolicy}
                  onChange={(e) => setOfflinePolicy(e.target.value)}
                  options={DELETE_POLICIES.map((p) => ({ value: p.value, label: p.label }))}
                  className="w-full"
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOfflineOpen(false)}>
              {t('取消')}
            </Button>
            {torrentInfo ? (
              <Button
                size="sm"
                disabled={offlineBusy || !offlineTool}
                onClick={submitTorrent}
              >
                {offlineBusy ? t('添加中…') : t('添加种子任务')}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={offlineBusy || !offlineUrls.trim() || !offlineTool}
                onClick={submitOffline}
              >
                {offlineBusy ? t('添加中…') : t('添加任务')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* rename dialog */}
      <RenameDialog
        open={renameTarget !== null}
        onOpenChange={(v) => !v && setRenameTarget(null)}
        name={renameTarget?.name ?? ''}
        onSubmit={doRename}
      />

      {/* regex rename dialog (current directory) */}
      <RegexRenameDialog
        open={regexOpen}
        onOpenChange={setRegexOpen}
        dir={path}
        names={content.map((o) => o.name)}
        onSubmit={async (src, dst) => {
          try {
            await fsRegexRename(path, src, dst)
            message.success(t('正则重命名完成'))
            refreshList()
          } catch (e) {
            message.error(e instanceof Error ? e.message : t('重命名失败'))
            throw e
          }
        }}
      />

      {/* batch rename dialog (selected objects) */}
      <BatchRenameDialog
        open={batchRenameOpen}
        onOpenChange={setBatchRenameOpen}
        names={selNames}
        onSubmit={async (pairs) => {
          try {
            await fsBatchRename(path, pairs)
            message.success(t('已重命名 {n} 项', { n: pairs.length }))
            setSelection(new Set())
            setSelectMode(false)
            refreshList()
          } catch (e) {
            message.error(e instanceof Error ? e.message : t('重命名失败'))
            throw e
          }
        }}
      />

      {/* move / copy dialog */}
      <MoveCopyDialog
        open={moveCopy !== null}
        onOpenChange={(v) => !v && setMoveCopy(null)}
        mode={moveCopy?.mode ?? 'move'}
        srcDir={path}
        names={moveCopy?.names ?? []}
        initialPath={path === '/' ? '/' : segments[segments.length - 2]?.path ?? '/'}
        onSubmit={doMoveCopy}
      />

      {/* upload progress panel */}
      {uploadsVisible && uploads.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium">
              {t('上传')} {allDone ? t('完成') : t('进行中')} · {doneCount}/{uploads.length}
            </span>
            <div className="flex items-center gap-1">
              {allDone && (
                <button
                  className="rounded-sm px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setUploads([])
                    setUploadsVisible(false)
                  }}
                >
                  {t('清除')}
                </button>
              )}
              <button
                aria-label={t("收起")}
                className="rounded-sm px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setUploadsVisible(false)}
              >
                {t('收起')}
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {uploads.map((u) => (
              <div key={u.id} className="border-b border-border px-3 py-2 last:border-b-0">
                <div className="flex items-center gap-2">
                  {u.status === 'done' ? (
                    <CircleCheckIcon className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : u.status === 'error' ? (
                    <CircleAlertIcon className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  ) : (
                    <UploadIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs" title={u.name}>
                    {u.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {u.status === 'done' ? t('完成') : u.status === 'error' ? t('失败') : `${u.percent}%`}
                  </span>
                </div>
                {u.status === 'uploading' && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${u.percent}%` }}
                    />
                  </div>
                )}
                {u.status === 'error' && u.error && (
                  <div className="mt-0.5 truncate text-xs text-red-400" title={u.error}>
                    {u.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
