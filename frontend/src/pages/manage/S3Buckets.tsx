import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { message, Button, Badge } from '@chaos_team/chaos-ui'
import { CloudIcon, HardDriveIcon, KeyRoundIcon, ScrollTextIcon, SaveIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { listSettings, saveSettings } from '../../api/admin'
import S3BucketsEditor from './S3BucketsEditor'
import { useI18n } from '../../i18n'

/** S3 gateway administration home: bucket routing config + links. */
export default function ManageS3Buckets() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [value, setValue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery({ queryKey: ['admin', 'settings'], queryFn: listSettings })
  const stored =
    list.data?.find((s) => s.key === 's3_buckets')?.value ?? '[]'
  // sync the working copy whenever a fresh settings payload lands
  // (initial load, and after save+invalidate)
  useEffect(() => {
    if (!list.isLoading) setValue(stored)
  }, [list.dataUpdatedAt])
  const dirty = value !== null && value !== stored

  const save = async () => {
    if (value === null) return
    setBusy(true)
    try {
      await saveSettings([{ key: 's3_buckets', value }])
      message.success(t('S3 桶配置已保存'))
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const subLink = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs transition-colors ${
      isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <CloudIcon className="h-4 w-4 text-primary" />
          {t('S3 网关')}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('把存储挂载路径映射为 S3 桶；一个桶可聚合多个路径（任一/全部写入策略）。')}
        </p>
      </div>

      {/* quick links to the other S3 pages */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <NavLink to="/admin/s3buckets" className={({ isActive }) => `rounded-md border px-3 py-2 hover:bg-muted/50 ${isActive ? 'border-primary/50 bg-muted/50' : 'border-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <HardDriveIcon className="h-3.5 w-3.5 text-primary" />
            {t('桶配置')}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('桶与路径映射')}</p>
        </NavLink>
        <NavLink to="/admin/s3keys" className={({ isActive }) => `rounded-md border px-3 py-2 hover:bg-muted/50 ${isActive ? 'border-primary/50 bg-muted/50' : 'border-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <KeyRoundIcon className="h-3.5 w-3.5 text-primary" />
            {t('访问密钥')}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('多密钥/权限/轮换')}</p>
        </NavLink>
        <NavLink to="/admin/s3audit" className={({ isActive }) => `rounded-md border px-3 py-2 hover:bg-muted/50 ${isActive ? 'border-primary/50 bg-muted/50' : 'border-border bg-card'}`}>
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ScrollTextIcon className="h-3.5 w-3.5 text-primary" />
            {t('审计日志')}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('请求记录/统计')}</p>
        </NavLink>
      </div>

      <S3BucketsEditor value={value ?? '[]'} onChange={setValue} />

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={!dirty || busy} onClick={save}>
          <SaveIcon className="mr-1.5 h-3.5 w-3.5" />
          {busy ? t('保存中…') : t('保存')}
        </Button>
        {dirty ? (
          <Badge variant="outline">{t('有未保存的修改')}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{t('无未保存修改')}</span>
        )}
      </div>
    </div>
  )
}
