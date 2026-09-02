import { useNavigate } from 'react-router-dom'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Button, useTheme } from '@chaos_team/chaos-ui'
import { CircleUserIcon, GlobeIcon, KeyRoundIcon, LogOutIcon, MoonIcon, SettingsIcon, SunIcon } from 'lucide-react'
import { useI18n } from '../i18n'

export default function TopBar({
  username,
  isAdmin,
  onLogout,
}: {
  username?: string
  isAdmin?: boolean
  onLogout: () => void
}) {
  const nav = useNavigate()
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme() as unknown as {
    theme?: string
    setTheme: (t: string) => void
  }
  const isDark = theme !== 'light'

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <button
          className="flex items-center gap-2"
          onClick={() => nav('/files')}
          title="chaos-oss"
        >
          <img src="/logo/logo.svg" alt="logo" className="h-5 w-5" />
          <span className="font-mono text-sm tracking-tight">chaos-oss</span>
        </button>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1 font-mono text-xs"
            title={lang === 'zh' ? 'Switch to English' : t('切换到中文')}
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          >
            <GlobeIcon className="h-4 w-4 text-muted-foreground" />
            {lang === 'zh' ? 'EN' : t('中')}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            title={isDark ? t('切换到浅色') : t('切换到深色')}
            aria-label={t("切换主题")}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 gap-2 font-mono text-xs">
                <CircleUserIcon className="h-4 w-4 text-muted-foreground" />
                {username ?? '...'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isAdmin && (
                <DropdownMenuItem onClick={() => nav('/admin/storages')}>
                  <SettingsIcon className="mr-2 h-4 w-4" />
                  {t('管理后台')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => nav('/profile')}>
                <KeyRoundIcon className="mr-2 h-4 w-4" />
                {t('个人设置')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout}>
                <LogOutIcon className="mr-2 h-4 w-4" />
                {t('退出登录')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
