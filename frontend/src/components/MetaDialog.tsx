import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { message, Button, Input, Textarea, Switch } from '@chaos_team/chaos-ui'
import { FolderCogIcon, Trash2Icon } from 'lucide-react'
import {
  listMetas,
  createMeta,
  updateMeta,
  deleteMeta,
  type Meta,
} from '../api/meta'
import { listUsers } from '../api/admin'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@chaos_team/chaos-ui'
import { useI18n } from '../i18n'

const emptyMeta: Partial<Meta> = {
  path: '',
  read_users: [],
  read_users_sub: false,
  write_users: [],
  write_users_sub: false,
  password: '',
  p_sub: false,
  write: false,
  w_sub: false,
  hide: '',
  h_sub: false,
  readme: '',
  r_sub: false,
  header: '',
  header_sub: false,
}

/** Per-path metadata editor, opened from the files-page context menu. */
export default function MetaDialog({
  open,
  onOpenChange,
  path,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** absolute path this meta applies to */
  path: string
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<Partial<Meta>>(emptyMeta)
  const [existingId, setExistingId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  // load the existing meta for this path (if any) + the user list
  const metas = useQuery({
    queryKey: ['admin', 'metas', 'all'],
    queryFn: () => listMetas(1, 0),
    enabled: open,
  })
  const users = useQuery({
    queryKey: ['admin', 'users', 'list'],
    queryFn: listUsers,
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    const found = (metas.data?.content ?? []).find((m) => m.path === path)
    if (found) {
      setForm({ ...emptyMeta, ...found })
      setExistingId(found.id)
    } else {
      setForm({ ...emptyMeta, path })
      setExistingId(null)
    }
  }, [open, path, metas.data])

  const set = <K extends keyof Meta>(k: K, v: Meta[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    setBusy(true)
    try {
      const payload = { ...form, path }
      if (existingId) await updateMeta({ ...payload, id: existingId })
      else await createMeta(payload)
      message.success(t('已保存'))
      onOpenChange(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existingId) return
    if (!confirm(t('删除该路径的元数据配置？'))) return
    setBusy(true)
    try {
      await deleteMeta(existingId)
      message.success(t('已删除'))
      onOpenChange(false)
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('删除失败'))
    } finally {
      setBusy(false)
    }
  }

  const subSwitch = (k: 'p_sub' | 'w_sub' | 'h_sub' | 'r_sub' | 'header_sub' | 'read_users_sub' | 'write_users_sub') => (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
      <Switch
        checked={Boolean(form[k])}
        onCheckedChange={(v) => set(k, v as never)}
      />
      {t('含子目录')}
    </label>
  )

  const userPicker = (key: 'read_users' | 'write_users', subKey: 'read_users_sub' | 'write_users_sub') => (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">
          {key === 'read_users' ? t('授权读取用户') : t('授权写入用户')}
        </label>
        {subSwitch(subKey)}
      </div>
      <div className="flex max-h-24 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-border p-2">
        {(users.data?.content ?? []).filter((u) => u.role !== 2).length === 0 && (
          <span className="text-xs text-muted-foreground">{t('无普通用户')}</span>
        )}
        {(users.data?.content ?? [])
          .filter((u) => u.role !== 2)
          .map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={(form[key] ?? []).includes(u.id)}
                onChange={(e) => {
                  const cur = form[key] ?? []
                  set(key, e.target.checked ? [...cur, u.id] : cur.filter((id) => id !== u.id))
                }}
                className="h-3.5 w-3.5 accent-[#6b88ff]"
              />
              {u.username}
            </label>
          ))}
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderCogIcon className="h-4 w-4 text-primary" />
            {t('目录元数据')}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="mb-3 truncate font-mono text-xs text-muted-foreground">{path}</p>
          <div className="grid gap-4">
            {/* password */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{t('访问密码')}</label>
                {subSwitch('p_sub')}
              </div>
              <Input
                type="password"
                value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
              />
            </div>

            {/* write permission */}
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">{t('允许写入')}</label>
              <div className="flex items-center gap-2">
                {subSwitch('w_sub')}
                <Switch checked={Boolean(form.write)} onCheckedChange={(v) => set('write', v)} />
              </div>
            </div>

            {/* hide patterns */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{t('隐藏文件（正则，逗号分隔）')}</label>
                {subSwitch('h_sub')}
              </div>
              <Textarea rows={2} value={form.hide ?? ''} onChange={(e) => set('hide', e.target.value)} />
            </div>

            {/* readme / header */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{t('Readme（目录说明，Markdown）')}</label>
                {subSwitch('r_sub')}
              </div>
              <Textarea rows={3} value={form.readme ?? ''} onChange={(e) => set('readme', e.target.value)} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">{t('Header（顶部公告，Markdown）')}</label>
                {subSwitch('header_sub')}
              </div>
              <Textarea rows={2} value={form.header ?? ''} onChange={(e) => set('header', e.target.value)} />
            </div>

            {/* user permission pickers */}
            {userPicker('read_users', 'read_users_sub')}
            {userPicker('write_users', 'write_users_sub')}
          </div>
        </DialogBody>
        <DialogFooter>
          {existingId && (
            <Button variant="ghost" size="sm" className="mr-auto text-destructive" disabled={busy} onClick={remove}>
              <Trash2Icon className="mr-1 h-3.5 w-3.5" />
              {t('删除配置')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('取消')}
          </Button>
          <Button size="sm" disabled={busy} onClick={submit}>
            {busy ? t('保存中…') : existingId ? t('保存') : t('创建')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
