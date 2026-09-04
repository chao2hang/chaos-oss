import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { z } from 'zod'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  message,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  PasswordInput,
} from '@chaos_team/chaos-ui'
import { FingerprintIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { webauthnLogin } from '../api/account'
import { useQuery } from '@tanstack/react-query'
import { getPublicSettings } from '../api/public'
import { GlobeIcon, KeySquareIcon } from 'lucide-react'
import { useI18n } from '../i18n'

type FormData = {
  username: string
  password: string
  otp?: string
}

export default function Login() {
  const { t, lang, setLang } = useI18n()
  const schema = useMemo(
    () =>
      z.object({
        username: z.string().min(1, t('请输入用户名')),
        password: z.string().min(1, t('请输入密码')),
        otp: z.string().optional(),
      }),
    [t],
  )
  const nav = useNavigate()
  const { login } = useAuth()
  const [params] = useSearchParams()
  const [submitting, setSubmitting] = useState(false)
  const pubSettings = useQuery({
    queryKey: ['public', 'settings'],
    queryFn: getPublicSettings,
    staleTime: 300_000,
  })
  const ssoEnabled = pubSettings.data?.sso_login_enabled === 'true'
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: localStorage.getItem('username') ?? '',
      password: '',
      otp: '',
    },
  })

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    try {
      await login(data.username, data.password, data.otp)
      localStorage.setItem('username', data.username)
      message.success(t('登录成功'))
      const redirect = params.get('redirect')
      nav(redirect && redirect.startsWith('/') ? redirect : '/files', {
        replace: true,
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('登录失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-3 top-3 h-9 gap-1 font-mono text-xs"
        title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
        onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      >
        <GlobeIcon className="h-4 w-4 text-muted-foreground" />
        {lang === 'zh' ? 'EN' : '中'}
      </Button>
      <div className="w-full max-w-[364px] p-6">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/logo/logo.svg" alt="chaos-oss" className="h-12 w-12" />
          <h1 className="text-xl font-semibold tracking-tight">{t('登录 chaos-oss')}</h1>
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-4 rounded-md border border-border bg-card p-6"
          >
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('用户名')}</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11 text-base md:h-9 md:text-sm"
                      placeholder="username"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('密码')}</FormLabel>
                  <FormControl>
                    <PasswordInput
                      className="h-11 text-base md:h-9 md:text-sm"
                      placeholder="password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="otp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('2FA 验证码（可选）')}</FormLabel>
                  <FormControl>
                    <Input
                      className="h-11 text-base md:h-9 md:text-sm"
                      placeholder={t('动态验证码')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="mt-2 h-11 w-full text-base md:h-9 md:text-sm"
              disabled={submitting}
            >
              {submitting ? t('登录中…') : t('登录')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="mt-2 h-11 w-full text-base md:h-9 md:text-sm"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true)
                try {
                  await webauthnLogin(form.getValues('username') || undefined)
                  window.location.href = '/files'
                } catch (e) {
                  message.error(e instanceof Error ? e.message : t('通行密钥登录失败'))
                } finally {
                  setSubmitting(false)
                }
              }}
            >
              <FingerprintIcon className="mr-1.5 h-4 w-4" />
              {t('通行密钥登录')}
            </Button>
            {ssoEnabled && (
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-11 w-full text-base md:h-9 md:text-sm"
                onClick={() => {
                  window.location.href = '/api/auth/sso'
                }}
              >
                <KeySquareIcon className="mr-1.5 h-4 w-4" />
                {t('SSO 单点登录')}
              </Button>
            )}
          </form>
        </Form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          chaos-oss
        </p>
      </div>
    </div>
  )
}
