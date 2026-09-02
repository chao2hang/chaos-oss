import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  message,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@chaos_team/chaos-ui'
import { FolderIcon, CornerLeftUpIcon } from 'lucide-react'
import { fsList } from '../api/fs'
import { joinPath, pathSegments } from '../lib/format'
import { useI18n } from '../i18n'

/** Rename dialog — pre-filled with the current name. */
export function RenameDialog({
  open,
  onOpenChange,
  name,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  name: string
  onSubmit: (newName: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setValue(name)
  }, [open, name])

  const submit = async () => {
    const v = value.trim()
    if (!v || v === name) {
      onOpenChange(false)
      return
    }
    setBusy(true)
    try {
      await onSubmit(v)
      onOpenChange(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('重命名失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('重命名')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button size="sm" disabled={busy || !value.trim()} onClick={submit}>
            {busy ? t('重命名中…') : t('重命名')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Move/copy dialog with a folder browser — pick a destination directory. */
export function MoveCopyDialog({
  open,
  onOpenChange,
  mode,
  srcDir,
  names,
  initialPath,
  onSubmit,
  title,
  confirmLabel,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  mode: 'move' | 'copy'
  srcDir: string
  names: string[]
  initialPath: string
  onSubmit: (dstDir: string) => Promise<void>
  /** override the default 移动到/复制到 title (e.g. 解压到) */
  title?: string
  /** override the default 确定到 … confirm label */
  confirmLabel?: (dstDir: string) => string
}) {
  const { t } = useI18n()
  // start browsing at the source's parent for the shortest trip
  const [dst, setDst] = useState(initialPath)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setDst(initialPath)
  }, [open, initialPath])

  const browse = useQuery({
    queryKey: ['fs', 'list', dst],
    queryFn: () => fsList({ path: dst, refresh: false }),
    enabled: open,
    retry: false,
  })

  const dirs = (browse.data?.content ?? [])
    .filter((o) => o.is_dir)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const segments = pathSegments(dst)
  const samePlace = dst === srcDir

  const submit = async () => {
    setBusy(true)
    try {
      await onSubmit(dst)
      onOpenChange(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : mode === 'move' ? t('移动失败') : t('复制失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {title ?? (mode === 'move' ? t('移动到') : t('复制到'))}
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {names.join(', ').slice(0, 40)}
              {names.join(', ').length > 40 ? '…' : ''}
            </span>
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {/* breadcrumb of the destination being browsed */}
          <Breadcrumb className="mb-2">
            <BreadcrumbList>
              {segments.map((seg, i) => (
                <span key={seg.path} className="flex items-center">
                  {i > 0 && <BreadcrumbSeparator />}
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      className="cursor-pointer"
                      onClick={() => setDst(seg.path)}
                    >
                      {seg.name}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>

          <div className="h-56 overflow-y-auto rounded-md border border-border">
            {browse.isLoading ? (
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-2/3" />
                ))}
              </div>
            ) : browse.isError ? (
              <div className="p-3 text-xs text-muted-foreground">
                {t('无法读取该目录（存储可能已卸载）')}
              </div>
            ) : dirs.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">{t('没有子文件夹')}</div>
            ) : (
              dirs.map((d) => (
                <button
                  key={d.name}
                  onClick={() => setDst(joinPath(dst, d.name))}
                  className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/70"
                >
                  <FolderIcon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{d.name}</span>
                </button>
              ))
            )}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={() => setDst(dst === '/' ? '/' : segments[segments.length - 2]?.path ?? '/')}
              disabled={dst === '/'}
              className="flex items-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <CornerLeftUpIcon className="h-3 w-3" />
              {t('上一级')}
            </button>
            <span className="font-mono text-xs text-muted-foreground">{dst}</span>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button size="sm" disabled={busy || samePlace} onClick={submit}>
            {busy
              ? mode === 'move'
                ? t('移动中…')
                : t('复制中…')
              : samePlace
                ? t('已在目标位置')
                : confirmLabel
                  ? confirmLabel(dst)
                  : `确定到 ${dst === '/' ? '/' : dst}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ regex rename ------------------------------ */

/** Regex rename with a live client-side preview (Go RE2 ≈ JS RegExp). */
export function RegexRenameDialog({
  open,
  onOpenChange,
  dir,
  names,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  dir: string
  /** all object names in the directory, for the preview */
  names: string[]
  onSubmit: (srcRegex: string, newRegex: string) => Promise<void>
}) {
  const { t } = useI18n()
  const [srcRegex, setSrcRegex] = useState('')
  const [newRegex, setNewRegex] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setSrcRegex('')
      setNewRegex('')
    }
  }, [open])

  let error = ''
  let re: RegExp | null = null
  if (srcRegex) {
    try {
      re = new RegExp(srcRegex)
    } catch (e) {
      error = e instanceof Error ? e.message : t('正则无效')
    }
  }

  const preview: { from: string; to: string }[] = re
    ? names
        .map((n) => ({ from: n, to: n.replace(re!, newRegex) }))
        .filter((p) => p.from !== p.to)
    : []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>正则重命名（{dir}）</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t('匹配正则（作用于文件名）')}
            </label>
            <Input
              value={srcRegex}
              onChange={(e) => setSrcRegex(e.target.value)}
              placeholder={t("例如 (\\d+)集")}
              className="font-mono"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t('替换为（$1 引用捕获组）')}
            </label>
            <Input
              value={newRegex}
              onChange={(e) => setNewRegex(e.target.value)}
              placeholder={t("例如 EP$1")}
              className="font-mono"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {preview.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-md border border-border p-2 font-mono text-xs">
              {preview.slice(0, 50).map((p) => (
                <div key={p.from} className="flex flex-col gap-0.5 border-b border-border py-1 last:border-0">
                  <span className="truncate text-muted-foreground">{p.from}</span>
                  <span className="truncate">→ {p.to}</span>
                </div>
              ))}
              {preview.length > 50 && (
                <p className="pt-1 text-muted-foreground">…以及另外 {preview.length - 50} 项</p>
              )}
            </div>
          )}
          {re && preview.length === 0 && !error && (
            <p className="text-xs text-muted-foreground">{t('没有文件匹配该正则')}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button
            size="sm"
            disabled={busy || !srcRegex || !!error || preview.length === 0}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit(srcRegex, newRegex)
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? t('重命名中…') : `重命名 ${preview.length} 项`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ batch rename ------------------------------ */

/** Batch rename — edit the new name of each selected object. */
export function BatchRenameDialog({
  open,
  onOpenChange,
  names,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  names: string[]
  onSubmit: (pairs: { src_name: string; new_name: string }[]) => Promise<void>
}) {
  const { t } = useI18n()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setEdits({})
  }, [open])

  const pairs = names
    .map((n) => ({ src_name: n, new_name: edits[n] ?? n }))
    .filter((p) => p.new_name && p.new_name !== p.src_name)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>批量重命名（{names.length} 项）</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2">
          <div className="max-h-64 overflow-y-auto">
            {names.map((n) => (
              <div key={n} className="border-b border-border py-2 last:border-0">
                <p className="mb-1 truncate font-mono text-xs text-muted-foreground">{n}</p>
                <Input
                  value={edits[n] ?? n}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [n]: e.target.value }))}
                  className="font-mono"
                />
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button
            size="sm"
            disabled={busy || pairs.length === 0}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit(pairs)
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? t('重命名中…') : `重命名 ${pairs.length} 项`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
