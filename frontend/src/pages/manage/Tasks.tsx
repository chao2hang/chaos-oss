import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  EmptyState,
} from '@chaos_team/chaos-ui'
import {
  BanIcon,
  RotateCcwIcon,
  Trash2Icon,
  EraserIcon,
} from 'lucide-react'
import {
  TASK_TYPES,
  TASK_TYPE_LABELS,
  taskListUndone,
  taskListDone,
  taskCancel,
  taskDelete,
  taskRetry,
  taskClearDone,
  taskRetryFailed,
  type TaskInfo,
  type TaskType,
} from '../../api/task'
import { formatBytes, formatTime } from '../../lib/format'
import { useI18n } from '../../i18n'

/** Human labels for the tache task states (int enum, see api/task.ts). */
const STATE_LABELS: Record<number, string> = {
  0: '等待中',
  1: '进行中',
  2: '成功',
  3: '取消中',
  4: '已取消',
  5: '出错',
  6: '失败中',
  7: '失败',
  8: '等待重试',
  9: '重试前',
}

const stateLabel = (s: number, t: (x: string) => string) => t(STATE_LABELS[s] ?? `状态${s}`)
const stateColor = (s: number) =>
  s === 2
    ? 'text-emerald-400'
    : s === 7 || s === 5
      ? 'text-red-400'
      : s === 4
        ? 'text-muted-foreground'
        : 'text-primary'

export default function ManageTasks() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [type, setType] = useState<TaskType>('copy')

  const undone = useQuery({
    queryKey: ['task', type, 'undone'],
    queryFn: () => taskListUndone(type),
    refetchInterval: 3000,
  })
  const done = useQuery({
    queryKey: ['task', type, 'done'],
    queryFn: () => taskListDone(type),
    refetchInterval: 10_000,
  })

  const undoneList = undone.data ?? []
  const doneList = done.data ?? []

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['task', type] })
  }

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      message.success(ok)
      refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('操作失败'))
    }
  }

  const progress = (t: TaskInfo) => (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${
            t.state === 2
              ? 'bg-emerald-400'
              : t.state === 7 || t.state === 5
                ? 'bg-red-400'
                : 'bg-primary'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {Math.round(t.progress)}%
      </span>
    </div>
  )

  return (
    <div className="p-4 md:p-8">
      {/* header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('任务')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('后台任务队列')} · {t(TASK_TYPE_LABELS[type])}
            {undoneList.length > 0 && ` · ${undoneList.length} 个进行中`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => act(() => taskRetryFailed(type), t('已提交重试'))}>
            <RotateCcwIcon className="mr-1.5 h-3.5 w-3.5" />
            {t('重试失败')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => act(() => taskClearDone(type), t('已清除'))}>
            <EraserIcon className="mr-1.5 h-3.5 w-3.5" />
            {t('清除已完成')}
          </Button>
        </div>
      </div>

      {/* type tabs */}
      <div className="mb-4 flex flex-wrap gap-1">
        {TASK_TYPES.map((typ) => (
          <button
            key={typ}
            onClick={() => setType(typ)}
            className={`rounded-sm px-2.5 py-1.5 text-xs transition-colors ${
              typ === type
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {t(TASK_TYPE_LABELS[typ])}
          </button>
        ))}
      </div>

      {/* undone tasks */}
      <h2 className="mb-2 text-sm font-medium">{t('进行中')}</h2>
      <div className="mb-6 overflow-x-auto rounded-md border border-border bg-card">
        {undoneList.length === 0 ? (
          <EmptyState title={t("没有进行中的任务")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">{t('名称')}</TableHead>
                <TableHead className="w-28">{t('进度')}</TableHead>
                <TableHead className="w-20">{t('状态')}</TableHead>
                <TableHead className="w-24">{t('大小')}</TableHead>
                <TableHead className="w-36">{t('开始时间')}</TableHead>
                <TableHead className="w-20 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {undoneList.map((tk) => (
                <TableRow key={tk.id}>
                  <TableCell>
                    <span className="block max-w-64 truncate" title={tk.name}>
                      {tk.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{tk.creator}</span>
                  </TableCell>
                  <TableCell>{progress(tk)}</TableCell>
                  <TableCell className={`text-xs ${stateColor(tk.state)}`}>
                    {stateLabel(tk.state, t)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {tk.total_bytes > 0 ? formatBytes(tk.total_bytes) : '-'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {tk.start_time ? formatTime(tk.start_time) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("取消")}
                      onClick={() => act(() => taskCancel(type, tk.id), t('已取消'))}
                    >
                      <BanIcon className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* done tasks */}
      <h2 className="mb-2 text-sm font-medium">{t('已完成')}</h2>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        {done.isError ? (
          <EmptyState variant="error" title={t("无法加载任务")} />
        ) : doneList.length === 0 ? (
          <EmptyState title={t("没有已完成的任务")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-48">{t('名称')}</TableHead>
                <TableHead className="w-28">{t('进度')}</TableHead>
                <TableHead className="w-20">{t('状态')}</TableHead>
                <TableHead className="w-24">{t('大小')}</TableHead>
                <TableHead className="w-36">{t('结束时间')}</TableHead>
                <TableHead className="w-20 text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doneList.map((tk) => (
                <TableRow key={tk.id}>
                  <TableCell>
                    <span className="block max-w-64 truncate" title={tk.name}>
                      {tk.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tk.creator}
                      {tk.error && (
                        <span className="ml-1 text-red-400" title={tk.error}>
                          · {tk.error.slice(0, 40)}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{progress(tk)}</TableCell>
                  <TableCell className={`text-xs ${stateColor(tk.state)}`}>
                    {stateLabel(tk.state, t)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {tk.total_bytes > 0 ? formatBytes(tk.total_bytes) : '-'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {tk.end_time ? formatTime(tk.end_time) : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {(tk.state === 4 || tk.state === 5 || tk.state === 7) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("重试")}
                          onClick={() => act(() => taskRetry(type, tk.id), t('已重试'))}
                        >
                          <RotateCcwIcon className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("删除记录")}
                        onClick={() => act(() => taskDelete(type, tk.id), t('已删除'))}
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
    </div>
  )
}
