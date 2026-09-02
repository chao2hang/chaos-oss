import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  message,
  Button,
  Spin,
  EmptyState,
} from '@chaos_team/chaos-ui'
import {
  ArrowLeftIcon,
  DownloadIcon,
  ExternalLinkIcon,
  MusicIcon,
} from 'lucide-react'
import { fsGet, fsList } from '../api/fs'
import { getPublicSettings } from '../api/public'
import { downloadUrl, proxyUrl } from '../api/client'
import { parsePreviewSettings, matchPreview, buildViewerUrl, ext, type PreviewSettings } from '../lib/preview'
import { formatBytes, joinPath } from '../lib/format'
import VideoPlayer from '../components/VideoPlayer'
import Markdown from '../components/Markdown'
import { useI18n } from '../i18n'

/** Resolve the playback source: proxy the types configured as proxied (m3u8...),
 * otherwise prefer the raw link. */
function mediaSrc(path: string, rawUrl: string | undefined, sign: string | undefined, ps: PreviewSettings): string {
  const p = proxyUrl(path, sign)
  if (ps.proxyTypes.has(ext(path))) return p
  return rawUrl || p
}

export default function Preview() {
  const { t } = useI18n()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const path = params.get('p') ?? ''
  const pwd = params.get('pwd') ?? ''
  const [viewer, setViewer] = useState<string | null>(null) // selected iframe viewer

  // share paths look like /@s{sid}{subpath} — anonymous visitors previewing
  // a share; media/download URLs use the /sd endpoint instead of /p and /d
  const isShare = path.startsWith('/@s')
  const shareRest = path.slice(3)
  const slash = shareRest.indexOf('/')
  const shareSid = slash === -1 ? shareRest : shareRest.slice(0, slash)
  const shareSub = slash === -1 ? '/' : shareRest.slice(slash)
  const shareUrl = (sub: string) =>
    `/sd/${shareSid}${sub === '/' ? '' : sub}${pwd ? `?pwd=${encodeURIComponent(pwd)}` : ''}`

  const info = useQuery({
    queryKey: ['fs', 'get', path, pwd],
    queryFn: () => fsGet(path, isShare ? pwd : undefined),
    enabled: !!path,
    retry: false,
  })
  const settings = useQuery({
    queryKey: ['public', 'settings'],
    queryFn: getPublicSettings,
    staleTime: 300_000,
  })

  // ---------------------------------------------------------------- subtitles
  // look for a same-name .vtt/.srt next to the video

  const dir = path.replace(/\/[^/]*$/, '') || '/'
  const siblings = useQuery({
    queryKey: ['fs', 'list', dir, pwd],
    queryFn: () => fsList({ path: dir, page: 1, perPage: 0, password: pwd }),
    staleTime: 60_000,
    retry: false,
  })
  const [subUrl, setSubUrl] = useState<string | undefined>(undefined)

  const subObj = useMemo(() => {
    const name = path.split('/').pop() ?? ''
    const base = name.replace(/\.[^.]+$/, '')
    const c = siblings.data?.content ?? []
    if (!base) return undefined
    return (
      c.find((o) => !o.is_dir && o.name.toLowerCase() === `${base}.vtt`.toLowerCase()) ??
      c.find((o) => !o.is_dir && o.name.toLowerCase() === `${base}.srt`.toLowerCase())
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblings.data, path])

  useEffect(() => {
    let revoked: string | null = null
    setSubUrl(undefined)
    if (!subObj) return
    const subSrc = isShare
      ? shareUrl(joinPath(shareSub.replace(/\/[^/]*$/, '') || '/', subObj.name))
      : proxyUrl(joinPath(dir, subObj.name), subObj.sign)
    if (/\.vtt$/i.test(subObj.name)) {
      setSubUrl(subSrc)
      return
    }
    // srt → vtt (timestamp commas become dots)
    fetch(subSrc)
      .then((r) => r.text())
      .then((txt) => {
        const vtt =
          'WEBVTT\n\n' +
          txt
            .replace(/^\uFEFF/, '')
            .replace(/\r+/g, '')
            .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
        const u = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        revoked = u
        setSubUrl(u)
      })
      .catch(() => {
        /* subtitle is best-effort */
      })
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subObj?.name, dir])

  const ps = settings.data ? parsePreviewSettings(settings.data) : null
  const match = info.data && ps ? matchPreview(info.data.name, ps) : null
  const sign = info.data?.sign
  const rawUrl = info.data?.raw_url || undefined
  const pUrl = isShare ? shareUrl(shareSub) : proxyUrl(path, sign)
  // share raw_url is a same-origin /sd link; iframe viewers need it absolute
  const absolute = (u: string) => (u.startsWith('http') ? u : window.location.origin + u)
  const eUrl = isShare
    ? absolute(rawUrl || shareUrl(shareSub))
    : rawUrl || window.location.origin + pUrl
  const dlUrl = isShare ? shareUrl(shareSub) : downloadUrl(path, sign)
  // for shares the /sd link already decides proxying server-side
  const src = isShare
    ? absolute(rawUrl || shareUrl(shareSub))
    : ps
      ? mediaSrc(path, rawUrl, sign, ps)
      : pUrl

  const viewerNames = match?.viewers ? Object.keys(match.viewers) : []
  const activeViewer =
    viewer && viewerNames.includes(viewer)
      ? viewer
      : viewerNames[0] ?? null

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} title={t("返回")} aria-label={t("返回")}>
            <ArrowLeftIcon className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-foreground">{info.data?.name ?? path}</div>
            <div className="text-xs text-muted-foreground">
              {info.data ? formatBytes(info.data.size) : ''} ·{' '}
              {isShare ? `/s/${shareSid}${shareSub === '/' ? '' : shareSub}` : path}
            </div>
          </div>
          {info.data && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                title={t("在新窗口打开")}
                onClick={() => window.open(eUrl, '_blank')}
              >
                <ExternalLinkIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title={t("下载")}
                onClick={() => window.open(dlUrl, '_blank')}
              >
                <DownloadIcon className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        {info.isLoading || (info.data && !ps) ? (
          <div className="flex h-64 items-center justify-center">
            <Spin size="lg" />
          </div>
        ) : info.isError ? (
          <EmptyState
            variant="error"
            title={t("无法读取文件")}
            description={info.error instanceof Error ? info.error.message : ''}
            action={<Button variant="outline" onClick={() => info.refetch()}>{t('重试')}</Button>}
          />
        ) : !info.data ? null : !match ? (
          <EmptyState
            title={t("不支持预览")}
            description="此文件类型没有配置预览方式，可直接下载"
            action={
              <Button onClick={() => window.open(dlUrl, '_blank')}>
                <DownloadIcon className="mr-1.5 h-4 w-4" />
                {t('下载')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* video — 西瓜播放器 */}
            {match.kind === 'video' && ps && (
              <VideoPlayer
                url={src}
                autoplay={ps.videoAutoplay}
                subtitle={subUrl}
              />
            )}

            {/* audio */}
            {match.kind === 'audio' && ps && (
              <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-8">
                <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-card">
                  {ps.audioCover ? (
                    <img src={ps.audioCover} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <MusicIcon className="h-16 w-16 text-muted-foreground" />
                  )}
                </div>
                <div className="w-full rounded-md border border-border bg-card p-4">
                  <div className="mb-2 truncate text-center text-sm">{info.data.name}</div>
                  <audio
                    className="w-full"
                    controls
                    autoPlay={ps.audioAutoplay}
                    src={src}
                  />
                </div>
              </div>
            )}

            {/* image */}
            {match.kind === 'image' && (
              <div className="flex justify-center">
                <img
                  src={pUrl}
                  alt={info.data.name}
                  className="max-h-[75vh] max-w-full rounded-md border border-border object-contain"
                />
              </div>
            )}

            {/* text — markdown renders rich, others show raw */}
            {match.kind === 'text' &&
              (ext(info.data.name) === 'md' ? <MarkdownPreview url={pUrl} /> : <TextPreview url={pUrl} />)}

            {/* iframe viewer (office / pdf / epub ...) */}
            {match.kind === 'iframe' && activeViewer && match.viewers && (
              <div className="flex flex-col gap-2">
                {viewerNames.length > 1 && (
                  <div className="flex items-center gap-1">
                    {viewerNames.map((name) => (
                      <button
                        key={name}
                        onClick={() => setViewer(name)}
                        className={`rounded-sm px-2.5 py-1 text-xs transition-colors ${
                          name === activeViewer
                            ? 'bg-accent text-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
                <iframe
                  title={`${info.data.name} preview`}
                  src={buildViewerUrl(match.viewers[activeViewer] ?? '', eUrl)}
                  className="h-[75vh] w-full rounded-md border border-border bg-card"
                />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

/** Fetch and render a markdown file as rich content. */
function MarkdownPreview({ url }: { url: string }) {
  const { t } = useI18n()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['preview', 'md', url],
    queryFn: async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`读取失败 (${res.status})`)
      return res.text()
    },
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin size="lg" />
      </div>
    )
  }
  if (error) {
    return (
      <EmptyState
        variant="error"
        title={t("无法读取内容")}
        description={error instanceof Error ? error.message : ''}
        action={<Button variant="outline" onClick={() => refetch()}>{t('重试')}</Button>}
      />
    )
  }
  return (
    <div className="overflow-auto rounded-md border border-border bg-card p-4">
      <Markdown>{data}</Markdown>
    </div>
  )
}

/** Fetch and display a text file (same-origin /p proxy). */
function TextPreview({ url }: { url: string }) {
  const { t } = useI18n()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['preview', 'text', url],
    queryFn: async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`读取失败 (${res.status})`)
      return res.text()
    },
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin size="lg" />
      </div>
    )
  }
  if (error) {
    return (
      <EmptyState
        variant="error"
        title={t("无法读取内容")}
        description={error instanceof Error ? error.message : ''}
        action={<Button variant="outline" onClick={() => refetch()}>{t('重试')}</Button>}
      />
    )
  }
  return (
    <pre className="overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs leading-relaxed text-[rgba(250,250,250,0.85)]">
      {data}
    </pre>
  )
}
