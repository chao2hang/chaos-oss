import { useEffect, useState } from 'react'
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
  Textarea,
} from '@chaos_team/chaos-ui'
import { CopyIcon, CircleCheckIcon } from 'lucide-react'
import { shareCreate, shareUpdate, shareUrl, type Sharing } from '../api/share'
import { useI18n } from '../i18n'

/** Convert an ISO string to a datetime-local input value (local timezone). */
function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const fromLocalInput = (v: string): string | null =>
  v ? new Date(v).toISOString() : null

export function ShareDialog({
  open,
  onOpenChange,
  files,
  sharing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** create mode: paths to share */
  files?: string[]
  /** edit mode: existing sharing */
  sharing?: Sharing | null
  onSaved?: (s: Sharing) => void
}) {
  const { t } = useI18n()
  const isEdit = !!sharing
  const [pwd, setPwd] = useState('')
  const [expires, setExpires] = useState('')
  const [maxAccessed, setMaxAccessed] = useState('')
  const [remark, setRemark] = useState('')
  const [readme, setReadme] = useState('')
  const [header, setHeader] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<Sharing | null>(null)

  useEffect(() => {
    if (open) {
      setCreated(null)
      setPwd(sharing?.pwd ?? '')
      setExpires(toLocalInput(sharing?.expires))
      setMaxAccessed(sharing?.max_accessed ? String(sharing.max_accessed) : '')
      setRemark(sharing?.remark ?? '')
      setReadme(sharing?.readme ?? '')
      setHeader(sharing?.header ?? '')
    }
  }, [open, sharing])

  const copyLink = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(shareUrl(created.id, created.pwd || undefined))
      message.success(t('链接已复制'))
    } catch {
      message.error(t('复制失败'))
    }
  }

  const submit = async () => {
    setBusy(true)
    try {
      const input = {
        pwd: pwd || '',
        expires: fromLocalInput(expires),
        max_accessed: maxAccessed ? Number(maxAccessed) : 0,
        remark,
        readme,
        header,
      }
      if (isEdit && sharing) {
        const s = await shareUpdate(sharing.id, { ...input, files: sharing.files })
        message.success(t('已保存'))
        onOpenChange(false)
        onSaved?.(s)
      } else {
        const s = await shareCreate({ files: files ?? [], ...input })
        setCreated(s)
        onSaved?.(s)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('操作失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('编辑分享') : t('创建分享')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {created ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <CircleCheckIcon className="h-4 w-4" />
                {t('分享创建成功')}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={shareUrl(created.id, created.pwd || undefined)}
                  className="font-mono text-xs"
                />
                <Button size="sm" variant="outline" onClick={copyLink}>
                  <CopyIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              {created.pwd && (
                <p className="text-xs text-muted-foreground">
                  {t('提取码：')}<span className="font-mono text-foreground">{created.pwd}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {!isEdit && files && (
                <p className="text-xs text-muted-foreground">
                  分享 {files.length} 个对象：
                  <span className="ml-1 font-mono">
                    {files.map((f) => f.split('/').pop()).join(', ').slice(0, 60)}
                    {files.map((f) => f.split('/').pop()).join(', ').length > 60 ? '…' : ''}
                  </span>
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('密码（可选）')}</label>
                  <Input
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder={t("留空则无需密码")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('最大访问次数（可选）')}</label>
                  <Input
                    type="number"
                    min={0}
                    value={maxAccessed}
                    onChange={(e) => setMaxAccessed(e.target.value)}
                    placeholder={t("不限")}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('过期时间（可选）')}</label>
                <Input
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('备注（可选）')}</label>
                <Input value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
              {isEdit && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">{t('页头 Header（Markdown，可选）')}</label>
                    <Textarea rows={2} value={header} onChange={(e) => setHeader(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">{t('说明 Readme（Markdown，可选）')}</label>
                    <Textarea rows={3} value={readme} onChange={(e) => setReadme(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {created ? (
            <>
              <Button size="sm" variant="outline" onClick={copyLink}>
                <CopyIcon className="mr-1.5 h-3.5 w-3.5" />
                {t('复制链接')}
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)}>
                {t('完成')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t('取消')}
              </Button>
              <Button size="sm" disabled={busy} onClick={submit}>
                {busy ? t('提交中…') : isEdit ? t('保存') : t('创建分享')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
