import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Button,
  Input,
  Textarea,
  Badge,
  Switch,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from '@chaos_team/chaos-ui'
import {
  DicesIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  RefreshCwIcon,
  ActivityIcon,
} from 'lucide-react'
import {
  listS3Keys,
  createS3Key,
  updateS3Key,
  deleteS3Key,
  s3Stats,
  type S3AccessKey,
  type S3KeyReq,
} from '../../api/s3admin'
import { formatBytes, formatTime } from '../../lib/format'
import { useI18n } from '../../i18n'


const randomChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
function randomString(n: number) {
  const arr = new Uint32Array(n)
  crypto.getRandomValues(arr)
  return Array.from(arr, (x) => randomChars[x % randomChars.length]).join('')
}

function formatBytesSafe(n: number) {
  return formatBytes(n)
}

/** Stats cards shown above the key table. */
function StatsCards() {
  const { t } = useI18n()
  const stats = useQuery({ queryKey: ['admin', 's3stats'], queryFn: s3Stats, refetchInterval: 5000 })
  const s = stats.data
  const cards = [
    { label: t('总请求'), value: s ? String(s.total) : '—' },
    { label: t('错误请求'), value: s ? String(s.errors) : '—' },
    { label: t('上传流量'), value: s ? formatBytesSafe(s.bytes_in) : '—' },
    { label: t('下载流量'), value: s ? formatBytesSafe(s.bytes_out) : '—' },
    { label: t('复制队列'), value: s ? String(s.replication_queue) : '—' },
  ]
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-md border border-border bg-card px-3 py-2">
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{c.value}</p>
        </div>
      ))}
    </div>
  )
}

interface KeyDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: S3AccessKey | null
}

function KeyDialog({ open, onOpenChange, editing }: KeyDialogProps) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [accessKey, setAccessKey] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [buckets, setBuckets] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [ipAllowlist, setIpAllowlist] = useState('')
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [generatedSecret, setGeneratedSecret] = useState('')

  // sync form when opening
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    setLastOpen(true)
    setGeneratedSecret('')
    setAccessKey(editing?.access_key ?? '')
    setSecretKey('')
    setBuckets(editing?.buckets ?? '')
    setReadOnly(editing?.read_only ?? false)
    setIpAllowlist(editing?.ip_allowlist ?? '')
    setRemark(editing?.remark ?? '')
  }
  if (!open && lastOpen) setLastOpen(false)

  const submit = async () => {
    const req: S3KeyReq = {
      access_key: accessKey || undefined,
      secret_key: secretKey || undefined,
      buckets,
      read_only: readOnly,
      ip_allowlist: ipAllowlist,
      remark,
    }
    setBusy(true)
    try {
      let showSecret = ''
      if (editing) {
        await updateS3Key(editing.id, req)
        message.success(t('已保存'))
      } else {
        const r = await createS3Key(req)
        // server-generated secret shown once for copy
        if (!req.secret_key && r.secret_key) {
          showSecret = `${r.key.access_key} / ${r.secret_key}`
        }
        message.success(t('密钥已创建'))
      }
      qc.invalidateQueries({ queryKey: ['admin', 's3keys'] })
      if (showSecret) {
        setGeneratedSecret(showSecret)
      } else {
        onOpenChange(false)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('编辑密钥') : t('新建密钥')}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {generatedSecret ? (
            <div className="space-y-2">
              <p className="text-sm">{t('密钥已创建，请立即复制（Secret 只显示一次）：')}</p>
              <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap">
                {generatedSecret}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard?.writeText(generatedSecret)
                  message.success(t('密钥已复制'))
                }}
              >
                {t('复制')}
              </Button>
              <Button size="sm" className="ml-2" onClick={() => onOpenChange(false)}>
                {t('完成')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {!editing && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">{t('Access Key ID（留空自动生成）')}</label>
                    <div className="flex gap-1.5">
                      <Input value={accessKey} onChange={(e) => setAccessKey(e.target.value)} className="font-mono text-xs" />
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => setAccessKey('chaos' + randomString(20))}>
                        <DicesIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">{t('Secret Key（留空自动生成）')}</label>
                    <div className="flex gap-1.5">
                      <Input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} className="font-mono text-xs" />
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSecretKey(randomString(40))}>
                        <DicesIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
              {editing && (
                <p className="text-xs text-muted-foreground">
                  {t('编辑时留空 Secret 表示保持不变；填写则轮换密钥。')}
                </p>
              )}
              {editing && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('轮换 Secret Key（可选）')}</label>
                  <div className="flex gap-1.5">
                    <Input
                      value={secretKey}
                      onChange={(e) => setSecretKey(e.target.value)}
                      className="font-mono text-xs"
                      placeholder="—"
                    />
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => setSecretKey(randomString(40))}>
                      <DicesIcon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('授权 Bucket（逗号分隔，留空 = 全部）')}</label>
                <Input value={buckets} onChange={(e) => setBuckets(e.target.value)} className="font-mono text-xs" placeholder="backup,media" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('IP 白名单（逗号分隔 IP/CIDR，留空 = 不限制）')}</label>
                <Input value={ipAllowlist} onChange={(e) => setIpAllowlist(e.target.value)} className="font-mono text-xs" placeholder="10.0.0.0/8,192.168.1.5" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={readOnly} onCheckedChange={setReadOnly} />
                <span className="text-sm">{t('只读（禁止写入/删除）')}</span>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{t('备注')}</label>
                <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
            </div>
          )}
        </DialogBody>
        {!generatedSecret && (
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('取消')}
            </Button>
            <Button size="sm" disabled={busy} onClick={submit}>
              {busy ? t('保存中…') : editing ? t('保存') : t('创建')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function ManageS3Keys() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<S3AccessKey | null>(null)
  const keys = useQuery({ queryKey: ['admin', 's3keys'], queryFn: listS3Keys })

  const toggle = useMutation({
    mutationFn: (k: S3AccessKey) =>
      updateS3Key(k.id, {
        buckets: k.buckets,
        read_only: k.read_only,
        enabled: !k.enabled,
        ip_allowlist: k.ip_allowlist,
        remark: k.remark,
      }),
    onSuccess: () => {
      message.success(t('已保存'))
      qc.invalidateQueries({ queryKey: ['admin', 's3keys'] })
    },
    onError: (e) => message.error(e instanceof Error ? e.message : t('保存失败')),
  })

  const remove = async (k: S3AccessKey) => {
    if (!confirm(t('删除密钥 {k}？', { k: k.access_key }))) return
    try {
      await deleteS3Key(k.id)
      message.success(t('已删除'))
      qc.invalidateQueries({ queryKey: ['admin', 's3keys'] })
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('删除失败'))
    }
  }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <KeyRoundIcon className="h-4 w-4 text-primary" />
            {t('S3 密钥')}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('S3 网关访问密钥：支持按 Bucket 授权、只读、IP 白名单与轮换。审计见「S3 审计」页。')}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('新建密钥')}
        </Button>
      </div>

      <StatsCards />

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5">{t('Access Key')}</th>
              <th className="px-4 py-2.5">{t('Bucket 范围')}</th>
              <th className="px-4 py-2.5">{t('权限')}</th>
              <th className="px-4 py-2.5">{t('IP 白名单')}</th>
              <th className="px-4 py-2.5">{t('备注')}</th>
              <th className="px-4 py-2.5">{t('最近使用')}</th>
              <th className="px-4 py-2.5">{t('启用')}</th>
              <th className="px-4 py-2.5 text-right">{t('操作')}</th>
            </tr>
          </thead>
          <tbody>
            {(keys.data ?? []).map((k) => (
              <tr key={k.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-mono text-xs">{k.access_key}</span>
                  <p className="text-[10px] text-muted-foreground">{formatTime(k.created_time)}</p>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {k.buckets ? (
                    <span className="font-mono">{k.buckets}</span>
                  ) : (
                    <Badge variant="secondary">{t('全部')}</Badge>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {k.read_only ? <Badge variant="outline">{t('只读')}</Badge> : <Badge>{t('读写')}</Badge>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {k.ip_allowlist || <span className="text-muted-foreground">{t('不限')}</span>}
                </td>
                <td className="max-w-40 truncate px-4 py-2.5 text-xs text-muted-foreground">{k.remark || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {k.last_used_time && !k.last_used_time.startsWith('0001') ? formatTime(k.last_used_time) : t('从未')}
                </td>
                <td className="px-4 py-2.5">
                  <Switch checked={k.enabled} onCheckedChange={() => toggle.mutate(k)} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('编辑')}
                    onClick={() => {
                      setEditing(k)
                      setDialogOpen(true)
                    }}
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" title={t('删除')} onClick={() => remove(k)}>
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {(keys.data ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('还没有密钥')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
        <ActivityIcon className="h-3 w-3" />
        {t('Prometheus 指标：')}
        <code className="rounded bg-muted px-1 font-mono">GET /metrics</code>
        {t('（需管理员 Token）')}
        <RefreshCwIcon className="ml-2 h-3 w-3" />
        {t('统计每 5 秒自动刷新')}
      </p>

      <KeyDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  )
}
