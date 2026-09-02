import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Input, Button } from '@chaos_team/chaos-ui'
import { SearchIcon, ScrollTextIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { listS3Audit } from '../../api/s3admin'
import { formatBytes, formatTime } from '../../lib/format'
import { useI18n } from '../../i18n'

const ACTIONS = ['GET', 'PUT', 'HEAD', 'DELETE', 'POST', 'MPU_INIT', 'MPU_COMPLETE', 'MPU_ABORT', 'LIST_MULTIPART']

export default function ManageS3Audit() {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  const [key, setKey] = useState('')
  const [bucket, setBucket] = useState('')
  const [action, setAction] = useState('')
  const [submitted, setSubmitted] = useState({ key: '', bucket: '', action: '' })
  const perPage = 20
  const audit = useQuery({
    queryKey: ['admin', 's3audit', page, submitted],
    queryFn: () => listS3Audit({ page, per_page: perPage, ...submitted }),
    refetchInterval: 10000,
  })
  const total = audit.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / perPage))

  const submit = () => {
    setPage(1)
    setSubmitted({ key, bucket, action })
  }

  const statusBadge = (s: number) => {
    if (s < 300) return <Badge className="bg-emerald-600">{s}</Badge>
    if (s < 400) return <Badge className="bg-amber-600">{s}</Badge>
    return <Badge variant="destructive">{s}</Badge>
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ScrollTextIcon className="h-4 w-4 text-primary" />
          {t('S3 审计日志')}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('S3 网关请求审计：谁（密钥）、何时、对哪个 Bucket/Object、做了什么、结果与耗时。保留 90 天。')}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t('Access Key')}
          className="w-44 font-mono text-xs"
        />
        <Input
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          placeholder={t('Bucket')}
          className="w-32 font-mono text-xs"
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">{t('全部操作')}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={submit}>
          <SearchIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('查询')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('共 {n} 条', { n: String(total) })}
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5">{t('时间')}</th>
              <th className="px-4 py-2.5">{t('密钥')}</th>
              <th className="px-4 py-2.5">{t('操作')}</th>
              <th className="px-4 py-2.5">{t('Bucket / Object')}</th>
              <th className="px-4 py-2.5">{t('状态')}</th>
              <th className="px-4 py-2.5">{t('大小')}</th>
              <th className="px-4 py-2.5">{t('耗时')}</th>
              <th className="px-4 py-2.5">{t('来源 IP')}</th>
            </tr>
          </thead>
          <tbody>
            {(audit.data?.content ?? []).map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-xs whitespace-nowrap text-muted-foreground">{formatTime(l.created_at)}</td>
                <td className="px-4 py-2 font-mono text-xs">{l.access_key || '—'}</td>
                <td className="px-4 py-2 font-mono text-xs">{l.action}</td>
                <td className="max-w-72 px-4 py-2 text-xs">
                  <span className="font-mono">{l.bucket}</span>
                  {l.object && <span className="font-mono text-muted-foreground">/{l.object}</span>}
                </td>
                <td className="px-4 py-2">{statusBadge(l.status)}</td>
                <td className="px-4 py-2 text-xs tabular-nums">{l.size > 0 ? formatBytes(l.size) : '—'}</td>
                <td className="px-4 py-2 text-xs tabular-nums">{l.duration} ms</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{l.client_ip}</td>
              </tr>
            ))}
            {total === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('暂无审计记录')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
