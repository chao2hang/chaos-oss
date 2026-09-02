import { useQuery, useQueryClient } from '@tanstack/react-query'
import { message, Button } from '@chaos_team/chaos-ui'
import {
  HammerIcon,
  RefreshCwIcon,
  SquareIcon,
  EraserIcon,
  CircleCheckIcon,
  CircleAlertIcon,
} from 'lucide-react'
import { indexBuild, indexUpdate, indexStop, indexClear, indexProgress } from '../api/search'
import { formatTime } from '../lib/format'
import { useI18n } from '../i18n'

/** Search index build controls + live progress (settings → 索引 group). */
export default function IndexManagement() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const progress = useQuery({
    queryKey: ['admin', 'index-progress'],
    queryFn: indexProgress,
    refetchInterval: 5000,
  })

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      message.success(ok)
      qc.invalidateQueries({ queryKey: ['admin', 'index-progress'] })
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('操作失败'))
    }
  }

  const p = progress.data
  const building = !!p && !p.is_done

  return (
    <div className="rounded-md border border-border bg-card p-5">
      <h3 className="mb-1 text-sm font-medium">{t('索引管理')}</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        {t('构建文件名索引后可在文件页搜索。索引进度每 5 秒自动刷新。')}
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => act(indexBuild, t('已开始构建'))}>
          <HammerIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('构建')}
        </Button>
        <Button size="sm" variant="outline" disabled={building} onClick={() => act(indexUpdate, t('已开始更新'))}>
          <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('更新')}
        </Button>
        <Button size="sm" variant="outline" disabled={!building} onClick={() => act(indexStop, t('已停止'))}>
          <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('停止')}
        </Button>
        <Button size="sm" variant="outline" className="text-red-400" onClick={() => act(indexClear, t('已清空'))}>
          <EraserIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('清空')}
        </Button>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>
          状态：
          {progress.isLoading ? (
            t('加载中…')
          ) : building ? (
            <span className="text-primary">{t('构建中…')}</span>
          ) : p?.is_done ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <CircleCheckIcon className="h-3.5 w-3.5" />
              已完成
              {p.last_done_time && ` · ${formatTime(p.last_done_time)}`}
            </span>
          ) : (
            t('未构建')
          )}
        </span>
        <span>已索引对象：{p ? p.obj_count.toLocaleString() : '—'}</span>
        {p?.error && (
          <span className="flex items-center gap-1 text-red-400">
            <CircleAlertIcon className="h-3.5 w-3.5" />
            {p.error}
          </span>
        )}
      </div>
    </div>
  )
}
