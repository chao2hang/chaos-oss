import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { message } from '@chaos_team/chaos-ui'
import {
  HardDriveIcon,
  UsersIcon,
  SettingsIcon,
  LogOutIcon,
  MenuIcon,
  XIcon,
  ListTodoIcon,
  Share2Icon,
  KeyRoundIcon,
  ScrollTextIcon,
  CloudIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { listSettings } from '../../api/admin'
import { SETTING_GROUPS } from '../../lib/settingGroups'
import { useI18n } from '../../i18n'

export default function ManageLayout() {
  const { t } = useI18n()
  const nav = useNavigate()
  const location = useLocation()
  const { logout } = useAuth()
  const [params] = useSearchParams()
  const [navOpen, setNavOpen] = useState(false)
  const onSettings = location.pathname.startsWith('/admin/settings')
  const activeGroup = Number(params.get('group') ?? 1)

  // shared react-query cache — no extra fetch when Settings page loaded it
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: listSettings,
    staleTime: 60_000,
  })
  const counts = new Map<number, number>()
  for (const s of settings.data ?? []) {
    counts.set(s.group, (counts.get(s.group) ?? 0) + 1)
  }

  // close the mobile drawer whenever the route changes
  useEffect(() => {
    setNavOpen(false)
  }, [location])

  const onLogout = async () => {
    await logout()
    message.success(t('已退出'))
  }

  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 rounded-sm px-3 py-2.5 text-sm transition-colors md:py-1.5 ${
      isActive
        ? 'bg-accent text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`

  const navContent = (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
      <NavLink to="/admin/storages" className={link}>
        <HardDriveIcon className="h-4 w-4" />
        {t('存储')}
      </NavLink>
      <NavLink to="/admin/users" className={link}>
        <UsersIcon className="h-4 w-4" />
        {t('用户')}
      </NavLink>
      <NavLink to="/admin/tasks" className={link}>
        <ListTodoIcon className="h-4 w-4" />
        {t('任务')}
      </NavLink>
      <NavLink to="/admin/shares" className={link}>
        <Share2Icon className="h-4 w-4" />
        {t('分享')}
      </NavLink>
      {/* S3 gateway group — bucket config / keys / audit */}
      <NavLink to="/admin/s3buckets" className={link}>
        <CloudIcon className="h-4 w-4" />
        {t('S3 网关')}
      </NavLink>
      {location.pathname.startsWith('/admin/s3') && (
        <div className="flex flex-col gap-1 pl-3">
          {[
            { to: '/admin/s3buckets', label: t('桶配置'), icon: HardDriveIcon },
            { to: '/admin/s3keys', label: t('访问密钥'), icon: KeyRoundIcon },
            { to: '/admin/s3audit', label: t('审计日志'), icon: ScrollTextIcon },
          ].map((s) => (
            <NavLink key={s.to} to={s.to} className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-sm py-2 pl-8 pr-3 text-xs transition-colors md:py-1.5 ${
                isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`
            }>
              <s.icon className="h-3.5 w-3.5" />
              {s.label}
            </NavLink>
          ))}
        </div>
      )}

      {/* settings accordion — groups inline in the main sidebar */}
      <NavLink to={`/admin/settings?group=${activeGroup}`} className={link}>
        <SettingsIcon className="h-4 w-4" />
        {t('设置')}
      </NavLink>
      {onSettings &&
        SETTING_GROUPS.filter((g) => counts.size === 0 || counts.has(g.id)).map(
          (g) => (
            <button
              key={g.id}
              onClick={() => nav(`/admin/settings?group=${g.id}`)}
              className={`flex items-center justify-between rounded-sm py-2.5 pl-8 pr-3 text-sm transition-colors md:py-1.5 ${
                activeGroup === g.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <g.icon className="h-3 w-3" />
                {t(g.label)}
              </span>
              {counts.get(g.id) !== undefined && (
                <span className="text-[10px] text-muted-foreground">
                  {counts.get(g.id)}
                </span>
              )}
            </button>
          ),
        )}
    </nav>
  )

  const sidebarFooter = (
    <div className="border-t border-border p-2">
      <button
        onClick={() => nav('/files')}
        className="w-full rounded-sm px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:py-1.5"
      >
        {t('← 返回文件')}
      </button>
      <button
        onClick={onLogout}
        className="flex w-full items-center gap-2 rounded-sm px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:py-1.5"
      >
        <LogOutIcon className="h-4 w-4" />
        {t('退出登录')}
      </button>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-background">
      {/* desktop sidebar: nav + settings accordion */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <img src="/logo/logo.svg" alt="logo" className="h-5 w-5" />
          <span className="font-mono text-sm tracking-tight">chaos-oss</span>
        </div>
        {navContent}
        {sidebarFooter}
      </aside>

      {/* mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-4 md:hidden">
        <div className="flex items-center gap-2">
          <img src="/logo/logo.svg" alt="logo" className="h-5 w-5" />
          <span className="font-mono text-sm tracking-tight">chaos-oss</span>
        </div>
        <button
          onClick={() => setNavOpen(true)}
          aria-label={t("打开菜单")}
          className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
      </header>

      {/* mobile drawer + backdrop */}
      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setNavOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <div className="flex items-center gap-2">
                <img src="/logo/logo.svg" alt="logo" className="h-5 w-5" />
                <span className="font-mono text-sm tracking-tight">chaos-oss</span>
              </div>
              <button
                onClick={() => setNavOpen(false)}
                aria-label={t("关闭菜单")}
                className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>
            {navContent}
            {sidebarFooter}
          </div>
        </div>
      )}

      {/* content */}
      <main className="min-w-0 flex-1 overflow-auto pt-14 md:pt-0">
        <Outlet />
      </main>
    </div>
  )
}
