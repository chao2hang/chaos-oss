import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
  Input,
} from '@chaos_team/chaos-ui'
import {
  ArrowLeftIcon,
  DownloadIcon,
  EyeIcon,
  FolderIcon,
  LockIcon,
} from 'lucide-react'
import { fsList, fsGet } from '../api/fs'
import { getPublicSettings } from '../api/public'
import { parsePreviewSettings, matchPreview } from '../lib/preview'
import { formatBytes, formatTime, joinPath } from '../lib/format'
import { FileIconCell } from '../components/FileIconCell'
import Markdown from '../components/Markdown'
import { useI18n } from '../i18n'

/** Public share browser: /s/:sid and /s/:sid/*subpath. */
export default function Share() {
  const { t } = useI18n()
  const nav = useNavigate()
  const { sid } = useParams()
  const sub = useParams()['*'] ?? ''
  const path = sub ? `/${sub}` : '/'
  const [pwd, setPwd] = useState('')
  const [pwdInput, setPwdInput] = useState('')

  // preview configuration (public settings — same as the files page)
  const settings = useQuery({
    queryKey: ['public', 'settings'],
    queryFn: getPublicSettings,
    staleTime: 300_000,
  })
  const ps = settings.data ? parsePreviewSettings(settings.data) : null

  const list = useQuery({
    queryKey: ['share', 'list', sid, path, pwd],
    queryFn: () => fsList({ path: `/@s${sid ?? ''}${path === '/' ? '' : path}`, password: pwd, refresh: false }),
    enabled: !!sid,
    retry: false,
  })

  // single-FILE shares cannot be listed at the root ("not a folder") —
  // fall back to fs/get which returns the object + direct /sd/ link.
  const notFolder = list.isError && (list.error?.message.includes('not a folder') ?? false)
  const rootGet = useQuery({
    queryKey: ['share', 'rootget', sid, pwd],
    queryFn: () => fsGet(`/@s${sid ?? ''}`, pwd),
    enabled: !!sid && notFolder,
    retry: false,
  })
  const singleFile = notFolder ? rootGet.data ?? null : null

  const content = list.data?.content ?? []
  const dirsFirst = [...content].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })

  const needsPwd =
    list.isError &&
    (list.error?.message.toLowerCase().includes('password') ||
      list.error?.message.toLowerCase().includes('code'))

  const subSegments = useMemo(() => {
    const segs: { name: string; path: string }[] = []
    let acc = ''
    for (const part of sub.split('/').filter(Boolean)) {
      acc += `/${part}`
      segs.push({ name: part, path: acc })
    }
    return segs
  }, [sub])

  /** Open/download a file via the backend-resolved /sd/ link.
   * Single-file shares expose the file AT the share root, so a failed
   * child lookup falls back to the root object itself. */
  const download = async (name: string) => {
    if (!sid) return
    const tryOpen = async (p: string) => {
      try {
        const info = await fsGet(`/@s${sid}${p}`, pwd)
        if (info.raw_url) {
          window.open(info.raw_url, '_blank')
          return true
        }
      } catch {
        /* try the next candidate */
      }
      return false
    }
    if (await tryOpen(joinPath(path, name))) return
    await tryOpen('/')
  }

  /** Preview a shared file via the public /spreview page. */
  const preview = (name: string) => {
    if (!sid) return
    const p = `/@s${sid}${joinPath(path, name)}`
    const q = pwd ? `&pwd=${encodeURIComponent(pwd)}` : ''
    nav(`/spreview?p=${encodeURIComponent(p)}${q}`)
  }

  /** Click behaviour: dir -> navigate; previewable file -> preview; else download. */
  const openObj = (obj: { name: string; is_dir: boolean }) => {
    if (obj.is_dir) {
      window.location.href = `${window.location.origin}/s/${sid}${joinPath(path, obj.name)}`
      return
    }
    if (ps && matchPreview(obj.name, ps)) {
      preview(obj.name)
      return
    }
    download(obj.name)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <svg viewBox="0 0 256 256" className="h-6 w-6" aria-hidden>
              <rect x="8" y="8" width="240" height="240" rx="48" fill="#101014" stroke="#23232a" />
              <path d="M84,62 V194 M84,122 H172 M84,194 H172" stroke="#fafafa" strokeWidth="18" strokeLinecap="square" fill="none" />
              <rect x="64" y="42" width="40" height="40" rx="10" fill="#fafafa" />
              <rect x="152" y="102" width="40" height="40" rx="10" fill="#6b88ff" />
              <rect x="152" y="174" width="40" height="40" rx="10" fill="#fafafa" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {t('分享')} <span className="font-mono">{sid}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6">
        {/* breadcrumb within the share */}
        {subSegments.length > 0 && (
          <div className="py-3">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink className="cursor-pointer" onClick={() => nav(`/s/${sid}`)}>
                    {t('根目录')}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {subSegments.map((seg) => (
                  <span key={seg.path} className="flex items-center">
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbLink
                        className="cursor-pointer"
                        onClick={() => nav(`/s/${sid}${seg.path}`)}
                      >
                        {seg.name}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                  </span>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        )}

        {/* header from share config */}
        {(list.data?.header ?? rootGet.data?.header) && (
          <div className="mb-3 rounded-md border border-border bg-card p-4">
            <Markdown>{(list.data?.header ?? rootGet.data?.header)!}</Markdown>
          </div>
        )}

        {/* password required */}
        {needsPwd && (
          <div className="rounded-md border border-border bg-card p-6">
            <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
              <LockIcon className="h-8 w-8 text-primary" />
              <p className="text-sm">{t('此分享需要提取码')}</p>
              <div className="flex w-full gap-2">
                <Input
                  type="password"
                  autoFocus
                  value={pwdInput}
                  onChange={(e) => setPwdInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && setPwd(pwdInput)}
                  placeholder={t("提取码")}
                />
                <Button size="sm" onClick={() => setPwd(pwdInput)}>
                  {t('解锁')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* error state (not the single-file case handled above) */}
        {list.isError && !needsPwd && !singleFile && !rootGet.isLoading && (
          <EmptyState
            variant="error"
            title={t("无法打开分享")}
            description={list.error instanceof Error ? list.error.message : t('分享不存在、已过期或已禁用')}
          />
        )}

        {/* single-file share: file card with download */}
        {singleFile && (
          <div className="rounded-md border border-border bg-card p-6">
            <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
              <FileIconCell obj={singleFile} className="h-12 w-12" />
              <div className="text-center">
                <div className="truncate text-sm text-foreground">{singleFile.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatBytes(singleFile.size)} · {formatTime(singleFile.modified)}
                </div>
              </div>
              <div className="flex gap-2">
                {ps && matchPreview(singleFile.name, ps) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const p = `/@s${sid}`
                      const q = pwd ? `&pwd=${encodeURIComponent(pwd)}` : ''
                      nav(`/spreview?p=${encodeURIComponent(p)}${q}`)
                    }}
                  >
                    <EyeIcon className="mr-1.5 h-4 w-4" />
                    {t('预览')}
                  </Button>
                )}
                <Button onClick={() => singleFile.raw_url && window.open(singleFile.raw_url, '_blank')}>
                  <DownloadIcon className="mr-1.5 h-4 w-4" />
                  {t('下载文件')}
                </Button>
              </div>
            </div>
          </div>
        )}
        {notFolder && rootGet.isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Skeleton className="h-4 w-40" />
          </div>
        )}

        {/* loading */}
        {!list.isError && list.isLoading && (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0">
                <Skeleton className="h-5 w-5 rounded-sm" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        )}

        {/* file list */}
        {!list.isError && !list.isLoading && dirsFirst.length > 0 && (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[52%]">{t('名称')}</TableHead>
                  <TableHead className="w-[16%]">{t('大小')}</TableHead>
                  <TableHead className="w-[24%]">{t('修改时间')}</TableHead>
                  <TableHead className="w-[16%] text-right">{t('操作')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dirsFirst.map((obj) => (
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
                      {!obj.is_dir && (
                        <>
                          {ps && matchPreview(obj.name, ps) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title={t("预览")}
                              onClick={(e) => {
                                e.stopPropagation()
                                preview(obj.name)
                              }}
                            >
                              <EyeIcon className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t("下载")}
                            onClick={(e) => {
                              e.stopPropagation()
                              download(obj.name)
                            }}
                          >
                            <DownloadIcon className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* empty share dir */}
        {!list.isError && !list.isLoading && dirsFirst.length === 0 && (
          <div className="rounded-md border border-border bg-card">
            <EmptyState icon={FolderIcon} title={t("目录为空")} />
          </div>
        )}

        {/* readme from share config */}
        {(list.data?.readme ?? rootGet.data?.readme) && (
          <div className="mt-4 rounded-md border border-border bg-card p-4">
            <Markdown>{(list.data?.readme ?? rootGet.data?.readme)!}</Markdown>
          </div>
        )}
      </main>
    </div>
  )
}
