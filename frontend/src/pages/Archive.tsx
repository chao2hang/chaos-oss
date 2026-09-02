import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  Button,
  EmptyState,
  Skeleton,
  Spin,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Input,
} from '@chaos_team/chaos-ui'
import {
  ArrowLeftIcon,
  DownloadIcon,
  FileArchiveIcon,
  LockIcon,
  PackageOpenIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { archiveMeta, archiveList, archiveDecompress, archiveExtractUrl } from '../api/archive'
import { downloadUrl } from '../api/client'
import { formatBytes, formatTime, joinPath } from '../lib/format'
import { FileIconCell } from '../components/FileIconCell'
import { MoveCopyDialog } from '../components/FileActionDialogs'
import type { Obj } from '../api/types'
import { useI18n } from '../i18n'

/** Archive browser: /archive?p=<archive path> — browse and extract archives. */
export default function Archive() {
  const { t } = useI18n()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const path = params.get('p') ?? ''
  const qc = useQueryClient()

  const [inner, setInner] = useState('/')
  const [archivePass, setArchivePass] = useState('')
  const [passInput, setPassInput] = useState('')
  const [decompressOpen, setDecompressOpen] = useState(false)

  useEffect(() => {
    setInner('/')
  }, [path])

  const meta = useQuery({
    queryKey: ['archive', 'meta', path, archivePass],
    queryFn: () => archiveMeta(path, archivePass),
    enabled: !!path,
    retry: false,
  })
  const list = useQuery({
    queryKey: ['archive', 'list', path, inner, archivePass],
    queryFn: () => archiveList(path, inner, archivePass),
    enabled: !!meta.data,
    retry: false,
  })

  const content = (list.data?.content ?? []).slice().sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })

  const passNeeded =
    (meta.isError &&
      (meta.error?.message.toLowerCase().includes('password') ||
        (meta.error as { code?: number })?.code === 202)) ||
    (list.isError &&
      (list.error?.message.toLowerCase().includes('password') ||
        (list.error as { code?: number })?.code === 202))

  // inner path breadcrumb segments
  const segments = useMemo(() => {
    const segs: { name: string; path: string }[] = []
    let acc = ''
    for (const part of inner.split('/').filter(Boolean)) {
      acc += `/${part}`
      segs.push({ name: part, path: acc })
    }
    return segs
  }, [inner])

  const archiveName = path.split('/').pop() || path

  const openObj = (obj: Obj) => {
    if (obj.is_dir) {
      setInner(joinPath(inner, obj.name))
      return
    }
    if (!meta.data) return
    window.open(archiveExtractUrl(meta.data, joinPath(inner, obj.name), archivePass), '_blank')
  }

  const doDecompress = async (dstDir: string) => {
    try {
      await archiveDecompress(path.replace(/\/[^/]*$/, '') || '/', dstDir, [archiveName], {
        archivePass,
        innerPath: inner,
      })
      message.success(t('已创建解压任务，可在任务中心查看进度'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('解压失败'))
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} title={t("返回")} aria-label={t("返回")}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 truncate text-sm text-foreground">
              <FileArchiveIcon className="h-4 w-4 shrink-0 text-primary" />
              {archiveName}
            </div>
            <div className="text-xs text-muted-foreground">{path}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              title={t("下载整个压缩包")}
              onClick={() => window.open(downloadUrl(path), '_blank')}
            >
              <DownloadIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={t("解压到…")}
              onClick={() => setDecompressOpen(true)}
            >
              <PackageOpenIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4 sm:px-6">
        {/* breadcrumb of the inner path */}
        <div className="mb-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink
                  className="cursor-pointer"
                  onClick={() => setInner('/')}
                >
                  {archiveName}
                </BreadcrumbLink>
              </BreadcrumbItem>
              {segments.map((seg) => (
                <span key={seg.path} className="flex items-center">
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink
                      className="cursor-pointer"
                      onClick={() => setInner(seg.path)}
                    >
                      {seg.name}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                </span>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        {/* archive password required */}
        {passNeeded && (
          <div className="rounded-md border border-border bg-card p-6">
            <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
              <LockIcon className="h-8 w-8 text-primary" />
              <p className="text-sm">{t('此压缩包已加密')}</p>
              <div className="flex w-full gap-2">
                <Input
                  type="password"
                  autoFocus
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setArchivePass(passInput)}
                  placeholder={t("压缩包密码")}
                />
                <Button size="sm" onClick={() => setArchivePass(passInput)}>
                  {t('解锁')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* error */}
        {meta.isError && !passNeeded && (
          <EmptyState
            variant="error"
            title={t("无法读取压缩包")}
            description={meta.error instanceof Error ? meta.error.message : ''}
            action={
              <Button variant="outline" onClick={() => meta.refetch()}>
                {t('重试')}
              </Button>
            }
          />
        )}

        {/* loading */}
        {(meta.isLoading || (meta.data && list.isLoading)) && !passNeeded && (
          <div className="flex h-64 items-center justify-center">
            <Spin size="lg" />
          </div>
        )}

        {/* content table */}
        {meta.data && !list.isLoading && !passNeeded && (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            {list.isError ? (
              <EmptyState
                variant="error"
                title={t("无法读取目录")}
                description={list.error instanceof Error ? list.error.message : ''}
              />
            ) : content.length === 0 ? (
              <EmptyState title={t("目录为空")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[52%]">{t('名称')}</TableHead>
                    <TableHead className="w-[16%]">{t('大小')}</TableHead>
                    <TableHead className="w-[24%]">{t('修改时间')}</TableHead>
                    <TableHead className="w-[8%] text-right">{t('操作')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {content.map((obj) => (
                    <TableRow
                      key={obj.name}
                      className="cursor-pointer"
                      onClick={() => openObj(obj)}
                    >
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
                        {!obj.is_dir && meta.data && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("提取")}
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(
                                archiveExtractUrl(meta.data!, joinPath(inner, obj.name), archivePass),
                                '_blank',
                              )
                            }}
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}

        <p className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>共 {list.data?.total ?? 0} 项{meta.data?.comment ? ` · 注释：${meta.data.comment.slice(0, 40)}` : ''}</span>
          {list.data && (
            <button
              className="flex items-center gap-1 hover:text-foreground"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['archive', 'list', path] })
                qc.invalidateQueries({ queryKey: ['archive', 'meta', path] })
              }}
            >
              <RefreshCwIcon className={`h-3 w-3 ${list.isFetching ? 'animate-spin' : ''}`} />
              {t('刷新')}
            </button>
          )}
        </p>
      </main>

      {/* decompress destination picker */}
      <MoveCopyDialog
        open={decompressOpen}
        onOpenChange={setDecompressOpen}
        mode="copy"
        srcDir={path.replace(/\/[^/]*$/, '') || '/'}
        names={[inner === '/' ? archiveName : `${archiveName}!${inner}`]}
        initialPath={path.replace(/\/[^/]*$/, '') || '/'}
        onSubmit={doDecompress}
        title={t("解压到")}
        confirmLabel={(dst) => `解压到 ${dst === '/' ? '/' : dst}`}
      />
    </div>
  )
}
