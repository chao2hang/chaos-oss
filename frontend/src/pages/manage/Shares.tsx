import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Button,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@chaos_team/chaos-ui'
import {
  CopyIcon,
  PencilIcon,
  Trash2Icon,
  BanIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from 'lucide-react'
import {
  shareList,
  shareDelete,
  shareSetDisabled,
  shareUrl,
  type Sharing,
} from '../../api/share'
import { ShareDialog } from '../../components/ShareDialog'
import { formatTime } from '../../lib/format'
import { useI18n } from '../../i18n'

const PER_PAGE = 50

export default function ManageShares() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Sharing | null>(null)

  const shares = useQuery({
    queryKey: ['shares', page],
    queryFn: () => shareList(page, PER_PAGE),
  })

  const list = shares.data?.content ?? []
  const total = shares.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const refresh = () => qc.invalidateQueries({ queryKey: ['shares'] })

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      message.success(ok)
      refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('操作失败'))
    }
  }

  const copyLink = async (s: Sharing) => {
    try {
      await navigator.clipboard.writeText(shareUrl(s.id, s.pwd || undefined))
      message.success(t('链接已复制'))
    } catch {
      message.error(t('复制失败'))
    }
  }

  const expired = (s: Sharing) =>
    !!s.expires && !!(new Date(s.expires) < new Date())

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">{t('分享')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('共 {n} 个分享 · 在文件页选择对象后可创建分享', { n: total })}
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        {shares.isError ? (
          <EmptyState variant="error" title={t("无法加载分享列表")} />
        ) : shares.isLoading ? (
          <EmptyState title={t("加载中…")} />
        ) : list.length === 0 ? (
          <EmptyState title={t("还没有分享")} description={t('在文件页右键或勾选文件即可创建分享链接')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">{t('分享 ID / 文件')}</TableHead>
                <TableHead className="w-16">{t('密码')}</TableHead>
                <TableHead className="w-24">{t('访问')}</TableHead>
                <TableHead className="w-36">{t('过期时间')}</TableHead>
                <TableHead className="w-20">{t('状态')}</TableHead>
                <TableHead className="w-28 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <span className="block font-mono text-xs text-foreground">{s.id}</span>
                    <span
                      className="block max-w-64 truncate text-xs text-muted-foreground"
                      title={s.files.join('\n')}
                    >
                      {s.files.length} 个对象 · {s.files[0]}
                      {s.files.length > 1 ? t(' 等') : ''}
                    </span>
                    {s.remark && (
                      <span className="block truncate text-xs text-muted-foreground">
                        备注：{s.remark}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.pwd ? (
                      <span className="font-mono text-foreground">{s.pwd}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {s.accessed}
                    {s.max_accessed > 0 ? ` / ${s.max_accessed}` : ' / ∞'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {s.expires ? formatTime(s.expires) : t('永不过期')}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.disabled ? (
                      <span className="text-muted-foreground">{t('已禁用')}</span>
                    ) : expired(s) ? (
                      <span className="text-red-400">{t('已过期')}</span>
                    ) : (
                      <span className="text-emerald-400">{t('生效中')}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" title={t("复制链接")} onClick={() => copyLink(s)}>
                        <CopyIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("编辑")}
                        onClick={() => setEditing(s)}
                      >
                        <PencilIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={s.disabled ? t('启用') : t('禁用')}
                        onClick={() => act(() => shareSetDisabled(s.id, !s.disabled), s.disabled ? t('已启用') : t('已禁用'))}
                      >
                        {s.disabled ? (
                          <CheckCircle2Icon className="h-4 w-4" />
                        ) : (
                          <BanIcon className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("删除")}
                        className="text-red-400"
                        onClick={() => {
                          if (confirm(`删除分享 ${s.id}？`))
                            act(() => shareDelete(s.id), t('已删除'))
                        }}
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
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

      {/* edit dialog */}
      <ShareDialog
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        sharing={editing}
        onSaved={refresh}
      />
    </div>
  )
}
