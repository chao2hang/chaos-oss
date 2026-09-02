import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Button,
  Input,
  Textarea,
  Badge,
} from '@chaos_team/chaos-ui'
import {
  GlobeIcon,
  KeyRoundIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  CopyIcon,
  KeySquareIcon,
  FingerprintIcon,
  Trash2Icon,
  PlusIcon,
} from 'lucide-react'
import { updateMe, generate2FA, verify2FA } from '../api/me'
import {
  listMySSHKeys,
  addMySSHKey,
  deleteMySSHKey,
  webauthnCredentials,
  webauthnRegister,
  webauthnDelete,
} from '../api/account'
import { useI18n } from '../i18n'

export default function Profile() {
  const { t, lang, setLang } = useI18n()
  const { user, logout } = useAuth()
  const nav = useNavigate()

  // ---- profile / password ----
  const [username, setUsername] = useState(user?.username ?? '')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)

  const saveProfile = async () => {
    if (pwd && pwd !== pwd2) {
      message.error(t('两次输入的密码不一致'))
      return
    }
    if (!username.trim()) {
      message.error(t('用户名不能为空'))
      return
    }
    setBusy(true)
    try {
      await updateMe({ username: username.trim(), password: pwd || undefined })
      message.success(pwd ? t('已保存，密码已修改，请重新登录') : t('已保存'))
      if (pwd) {
        // password change invalidates tokens
        await logout()
        nav('/login')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('保存失败'))
    } finally {
      setBusy(false)
    }
  }

  // ---- 2FA ----
  const [twoFA, setTwoFA] = useState<{ qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [faBusy, setFaBusy] = useState(false)
  const has2FA = !!user?.otp

  const start2FA = async () => {
    setFaBusy(true)
    try {
      const r = await generate2FA()
      setTwoFA(r)
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('生成失败'))
    } finally {
      setFaBusy(false)
    }
  }

  const confirm2FA = async () => {
    if (!twoFA || !code.trim()) return
    setFaBusy(true)
    try {
      await verify2FA(code.trim(), twoFA.secret)
      message.success(t('两步验证已绑定'))
      setTwoFA(null)
      setCode('')
      // otp flag comes from /api/me — refresh the page to re-read it
      window.location.reload()
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('验证失败'))
    } finally {
      setFaBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Button variant="ghost" size="icon" onClick={() => nav(-1)} title={t("返回")} aria-label={t("返回")}>
            <KeyRoundIcon className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-9 gap-1 font-mono text-xs"
            title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          >
            <GlobeIcon className="h-4 w-4 text-muted-foreground" />
            {lang === 'zh' ? 'EN' : '中'}
          </Button>
          <h1 className="text-sm font-medium">{t('个人设置')}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        {/* profile + password */}
        <section className="rounded-md border border-border bg-card p-5">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <UserRoundIcon className="h-4 w-4 text-primary" />
            {t('账号')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('修改密码后所有登录会失效，需要重新登录。')}
          </p>
          <div className="flex flex-col gap-3 sm:max-w-sm">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('用户名')}</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('新密码（留空则不修改）')}</label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('确认新密码')}</label>
              <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" />
            </div>
            <Button size="sm" disabled={busy} onClick={saveProfile} className="w-fit">
              {busy ? t('保存中…') : t('保存')}
            </Button>
          </div>
        </section>

        {/* 2FA */}
        <section className="rounded-md border border-border bg-card p-5">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <ShieldCheckIcon className="h-4 w-4 text-primary" />
            {t('两步验证（2FA）')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('绑定 TOTP 应用（Google Authenticator、1Password 等），登录时需要额外输入动态验证码。')}
          </p>

          {has2FA ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <ShieldCheckIcon className="h-4 w-4" />
              {t('已绑定两步验证')}
              <span className="text-xs text-muted-foreground">
                {t('（如需解绑请联系管理员在用户管理中取消）')}
              </span>
            </div>
          ) : twoFA ? (
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <img
                src={twoFA.qr}
                alt="2FA QR code"
                className="h-40 w-40 rounded-md border border-border bg-white p-2"
              />
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  {t('用验证器应用扫码，或手动输入密钥：')}
                </p>
                <button
                  className="flex w-fit items-center gap-1.5 rounded-sm bg-muted px-2 py-1 font-mono text-xs text-foreground"
                  onClick={() => {
                    navigator.clipboard.writeText(twoFA.secret).then(
                      () => message.success(t('密钥已复制')),
                      () => message.error(t('复制失败')),
                    )
                  }}
                >
                  {twoFA.secret}
                  <CopyIcon className="h-3 w-3" />
                </button>
                <div className="flex gap-2">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t("输入 6 位验证码")}
                    className="w-40 font-mono"
                  />
                  <Button size="sm" disabled={faBusy || !code.trim()} onClick={confirm2FA}>
                    {t('绑定')}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" disabled={faBusy} onClick={start2FA}>
              {faBusy ? t('生成中…') : t('开始绑定')}
            </Button>
          )}
        </section>

        <SSHKeySection />
        <WebAuthnSection />
      </main>
    </div>
  )
}

/* ------------------------------ SSH public keys ------------------------------ */

function SSHKeySection() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['me', 'sshkeys'], queryFn: listMySSHKeys })
  const [title, setTitle] = useState('')
  const [keyStr, setKeyStr] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!title.trim() || !keyStr.trim()) {
      message.error(t('标题和公钥都不能为空'))
      return
    }
    setBusy(true)
    try {
      await addMySSHKey(title.trim(), keyStr.trim())
      message.success(t('已添加'))
      setTitle('')
      setKeyStr('')
      qc.invalidateQueries({ queryKey: ['me', 'sshkeys'] })
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('添加失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <KeySquareIcon className="h-4 w-4 text-primary" />
        {t('SSH 公钥')}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {t('用于 SFTP 登录时的公钥认证。')}
      </p>

      <div className="mb-4 flex flex-col gap-2">
        {(keys.data?.content ?? []).length === 0 && !keys.isLoading && (
          <p className="text-xs text-muted-foreground">{t('还没有添加公钥')}</p>
        )}
        {(keys.data?.content ?? []).map((k) => (
          <div key={k.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <span className="text-sm">{k.title}</span>
            <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
              {k.fingerprint}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7"
              title={t("删除")}
              onClick={() => {
                if (confirm(`删除公钥 ${k.title}？`)) {
                  deleteMySSHKey(k.id).then(
                    () => {
                      message.success(t('已删除'))
                      qc.invalidateQueries({ queryKey: ['me', 'sshkeys'] })
                    },
                    (e) => message.error(e instanceof Error ? e.message : t('删除失败')),
                  )
                }
              }}
            >
              <Trash2Icon className="h-3.5 w-3.5 text-red-400" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:max-w-md">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("标题（如 my-laptop）")} />
        <Textarea
          rows={3}
          value={keyStr}
          onChange={(e) => setKeyStr(e.target.value)}
          placeholder="ssh-ed25519 AAAA…"
          className="font-mono text-xs"
        />
        <Button size="sm" disabled={busy} onClick={add} className="w-fit">
          <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
          {t('添加公钥')}
        </Button>
      </div>
    </section>
  )
}

/* ------------------------------ WebAuthn / passkeys ------------------------------ */

function WebAuthnSection() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const creds = useQuery({
    queryKey: ['me', 'webauthn-creds'],
    queryFn: webauthnCredentials,
    retry: false,
  })
  const [busy, setBusy] = useState(false)

  const list = creds.data ?? []

  const register = async () => {
    setBusy(true)
    try {
      await webauthnRegister()
      message.success(t('已绑定通行密钥'))
      qc.invalidateQueries({ queryKey: ['me', 'webauthn-creds'] })
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('绑定失败（可能站点未启用 WebAuthn）'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-medium">
        <FingerprintIcon className="h-4 w-4 text-primary" />
        {t('通行密钥（WebAuthn）')}
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        {t('绑定后可在登录页使用指纹 / 面容 / 安全密钥免密登录。需管理员在 设置 → 全局 中启用。')}
      </p>

      <div className="mb-4 flex flex-col gap-2">
        {creds.isError && (
          <p className="text-xs text-muted-foreground">{t('此站点未启用 WebAuthn')}</p>
        )}
        {list.map((c, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <FingerprintIcon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">密钥 #{i + 1}</span>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {c.fingerprint}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7"
              title={t("删除")}
              onClick={() => {
                if (confirm(t('删除此通行密钥？'))) {
                  webauthnDelete(c.id).then(
                    () => {
                      message.success(t('已删除'))
                      qc.invalidateQueries({ queryKey: ['me', 'webauthn-creds'] })
                    },
                    (e) => message.error(e instanceof Error ? e.message : t('删除失败')),
                  )
                }
              }}
            >
              <Trash2Icon className="h-3.5 w-3.5 text-red-400" />
            </Button>
          </div>
        ))}
      </div>

      {!creds.isError && (
        <Button size="sm" variant="outline" disabled={busy} onClick={register}>
          <FingerprintIcon className="mr-1.5 h-3.5 w-3.5" />
          {busy ? t('请完成验证…') : t('添加通行密钥')}
        </Button>
      )}
    </section>
  )
}
