import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  message,
  Button,
  Input,
  PasswordInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Skeleton,
  EmptyState,
  Textarea,
} from '@chaos_team/chaos-ui'
import { DicesIcon, SaveIcon, SearchIcon } from 'lucide-react'
import { settingGroup } from '../../lib/settingGroups'
import { listSettings, saveSettings, type SettingItem } from '../../api/admin'
import IndexManagement from '../../components/IndexManagement'
import { useI18n } from '../../i18n'

const INDEX_GROUP = 6

/** flag: 0=PUBLIC 1=PRIVATE 2=READONLY */
const FLAG_PRIVATE = 1
const FLAG_READONLY = 2

/** Chinese labels for setting keys. */
const LABELS: Record<string, string> = {
  token: 'API 令牌',
  index_progress: '索引进度',
  version: '版本',
  site_title: '站点标题',
  announcement: '公告',
  pagination_type: '分页类型',
  default_page_size: '默认每页数量',
  allow_indexed: '允许索引',
  allow_mounted: '允许挂载',
  robots_txt: 'robots.txt',
  logo: 'Logo',
  favicon: '网站图标',
  main_color: '主题色',
  home_icon: '主页图标',
  share_icon: '分享图标',
  home_container: '主页容器',
  settings_layout: '设置布局',
  hide_storage_details: '隐藏存储详情',
  hide_storage_details_in_manage_page: '管理页隐藏存储详情',
  show_disk_usage_in_plain_text: '纯文本显示磁盘用量',
  text_types: '文本类型',
  audio_types: '音频类型',
  video_types: '视频类型',
  image_types: '图片类型',
  proxy_types: '代理类型',
  proxy_ignore_headers: '代理忽略的响应头',
  external_previews: '外部预览',
  iframe_previews: 'iframe 预览',
  audio_cover: '音频封面',
  audio_autoplay: '音频自动播放',
  video_autoplay: '视频自动播放',
  preview_download_by_default: '预览页默认显示下载',
  preview_archives_by_default: '预览页默认显示压缩包',
  share_preview_download_by_default: '分享预览默认显示下载',
  share_preview_archives_by_default: '分享预览默认显示压缩包',
  readme_autorender: '自动渲染 README',
  filter_readme_scripts: '过滤 README 脚本',
  non_efs_zip_encoding: '非 EFS zip 编码',
  hide_files: '隐藏文件',
  package_download: '打包下载',
  customize_head: '自定义 head',
  customize_body: '自定义 body',
  link_expiration: '链接过期时间',
  sign_all: '所有链接签名',
  privacy_regs: '隐私正则',
  ocr_api: 'OCR 接口',
  filename_char_mapping: '文件名字符映射',
  forward_direct_link_params: '转发直链参数',
  ignore_direct_link_params: '忽略直链参数',
  webauthn_login_enabled: 'WebAuthn 登录',
  share_preview: '分享页预览',
  share_archive_preview: '分享页压缩包预览',
  share_force_proxy: '分享强制代理',
  share_summary_content: '分享摘要内容',
  handle_hook_after_writing: '写入后钩子',
  handle_hook_rate_limit: '钩子频率限制',
  ignore_system_files: '忽略系统文件',
  '123_temp_dir': '123 临时目录',
  aria2_secret: 'Aria2 密钥',
  aria2_uri: 'Aria2 地址',
  qbittorrent_seedtime: 'qBittorrent 做种时间',
  qbittorrent_url: 'qBittorrent 地址',
  transmission_seedtime: 'Transmission 做种时间',
  transmission_uri: 'Transmission 地址',
  search_index: '搜索索引',
  auto_update_index: '自动更新索引',
  ignore_paths: '忽略路径',
  max_index_depth: '最大索引深度',
  sso_login_enabled: '启用 SSO 登录',
  sso_login_platform: 'SSO 平台',
  sso_client_id: '客户端 ID',
  sso_client_secret: '客户端密钥',
  sso_oidc_username_key: 'OIDC 用户名字段',
  sso_organization_name: '组织名称',
  sso_application_name: '应用名称',
  sso_endpoint_name: '端点名称',
  sso_jwt_public_key: 'JWT 公钥',
  sso_extra_scopes: '额外 Scopes',
  sso_auto_register: '自动注册',
  sso_default_dir: '默认目录',
  sso_default_permission: '默认权限',
  sso_compatibility_mode: '兼容模式',
  ldap_login_enabled: '启用 LDAP 登录',
  ldap_server: 'LDAP 服务器',
  ldap_skip_tls_verify: '跳过 TLS 验证',
  ldap_manager_dn: '管理员 DN',
  ldap_manager_password: '管理员密码',
  ldap_user_search_base: '用户搜索基准',
  ldap_user_search_filter: '用户搜索过滤器',
  ldap_default_dir: '默认目录',
  ldap_default_permission: '默认权限',
  ldap_login_tips: '登录提示',
  s3_access_key_id: 'S3 访问密钥 ID',
  s3_secret_access_key: 'S3 访问密钥 Secret',
  s3_replication_default_policy: '复制默认策略',
  s3_replication_grace_seconds: '复制重试宽限期（秒）',
  ftp_public_host: 'FTP 公网地址',
  ftp_pasv_port_map: '被动端口映射',
  ftp_mandatory_tls: '强制 TLS',
  ftp_implicit_tls: '隐式 TLS',
  ftp_tls_private_key_path: 'TLS 私钥路径',
  ftp_tls_public_cert_path: 'TLS 证书路径',
  sftp_disable_password_login: 'SFTP 禁用密码登录',
  offline_download_task_threads_num: '离线下载任务线程数',
  offline_download_transfer_task_threads_num: '离线下载传输线程数',
  upload_task_threads_num: '上传任务线程数',
  copy_task_threads_num: '复制任务线程数',
  move_task_threads_num: '移动任务线程数',
  decompress_download_task_threads_num: '解压下载线程数',
  decompress_upload_task_threads_num: '解压上传线程数',
  max_client_download_speed: '客户端下载限速',
  max_client_upload_speed: '客户端上传限速',
  max_server_download_speed: '服务端下载限速',
  max_server_upload_speed: '服务端上传限速',
  multipart_enabled: '启用分片上传',
  multipart_chunk_size: '分片大小',
}

/**
 * 真正的机密字段才用密码框。后端的 PRIVATE flag 语义是"不通过公开设置
 * 接口暴露"（65 个字段都是 flag=1，包括线程数、路径等），并不是机密 ——
 * 只按命名识别 secret / password / token（排除 public key）。
 */
function isPasswordField(key: string): boolean {
  const k = key.toLowerCase()
  return (
    (k.includes('secret') ||
      k.includes('password') ||
      k === 'token' ||
      k.endsWith('_token')) &&
    !k.includes('public')
  )
}

/** 明确应该用多行编辑的 key（HTML/JSON/Markdown/长列表）。 */
const MULTILINE_KEYS = new Set([
  'announcement',
  'customize_head',
  'customize_body',
  'robots_txt',
  'privacy_regs',
  'filename_char_mapping',
  'external_previews',
  'iframe_previews',
  'sso_jwt_public_key',
  'share_summary_content',
  'index_progress',
  'text_types',
  'audio_types',
  'video_types',
  'image_types',
  'proxy_ignore_headers',
  'ldap_user_search_filter',
  'ocr_api',
])

/** 多行内容判定：后端 text 类型 / 已知长字段 / 换行 / 超长 / JSON。 */
function isMultiline(item: SettingItem): boolean {
  if (item.type === 'text') return true
  if (MULTILINE_KEYS.has(item.key)) return true
  const v = item.value
  const t = v.trim()
  if (v.includes('\n')) return true
  if (v.length > 80) return true
  if (t.startsWith('{') || t.startsWith('[')) return true
  return false
}

/**
 * 混合布局分派：多行编辑（textarea）与超长只读值占整行，
 * 其余短控件（开关/下拉/数字/密码/短文本）进双列网格。
 */
function isFullWidth(item: SettingItem, readonly: boolean): boolean {
  if (readonly) return item.value.includes('\n') || item.value.length > 60
  return isMultiline(item)
}

/** 单元格头部：左侧名称 + 徽标，右侧灰色小字显示设置键名。 */
function FieldHeader({
  label,
  itemKey,
  isPrivate,
  readonly,
}: {
  label: string
  itemKey: string
  isPrivate: boolean
  readonly?: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="min-w-0 flex-1 truncate text-sm font-medium leading-none">
        {label}
      </label>
      {isPrivate && (
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
          {t('私有')}
        </span>
      )}
      {readonly && (
        <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
          {t('只读')}
        </span>
      )}
      <span className="ml-1 max-w-[45%] shrink-0 truncate font-mono text-[10px] leading-none text-muted-foreground/50">
        {itemKey}
      </span>
    </div>
  )
}

/** Typed editor for a single setting item. */
function SettingControl({
  item,
  value,
  onChange,
}: {
  item: SettingItem
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useI18n()
  if (item.type === 'bool') {
    return (
      <Switch
        checked={value === 'true'}
        onCheckedChange={(v) => onChange(v ? 'true' : 'false')}
      />
    )
  }
  if (item.type === 'select') {
    let opts: string[] = []
    try {
      const v = JSON.parse(item.options || '[]')
      opts = Array.isArray(v) ? v.map(String) : []
    } catch {
      opts = []
    }
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  // 真正的机密（secret/password/token 命名）才用密码框
  if (isPasswordField(item.key)) {
    return (
      <PasswordInput
        name={item.key}
        className="h-8 font-mono text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  if (item.type === 'number') {
    return (
      <Input
        name={item.key}
        className="h-8 font-mono text-xs"
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  // 多行内容（text 类型 / 长值 / JSON / HTML）用 textarea
  if (isMultiline(item)) {
    const lines = value.split('\n').length
    const rows = Math.min(10, Math.max(3, lines + (value.length > 160 ? 2 : 0)))
    return (
      <Textarea
        name={item.key}
        className="w-full max-w-3xl font-mono text-xs"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Input
      name={item.key}
      className="h-8 font-mono text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export default function ManageSettings() {
  const { t } = useI18n()
  const qc = useQueryClient()
  // group selection lives in the URL (?group=N) — driven by the sidebar
  const [params, setParams] = useSearchParams()
  const group = Number(params.get('group') ?? 1)
  const groupDef = settingGroup(group)
  const [filter, setFilter] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})

  const list = useQuery({ queryKey: ['admin', 'settings'], queryFn: listSettings })

  useEffect(() => {
    setEdits({})
  }, [list.dataUpdatedAt, group])

  const all = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
    [list.data],
  )

  const items = useMemo(() => {
    const inGroup = all.filter((s) => s.group === group)
    const f = filter.trim().toLowerCase()
    if (!f) return inGroup
    return inGroup.filter(
      (s) =>
        s.key.toLowerCase().includes(f) ||
        s.value.toLowerCase().includes(f) ||
        (LABELS[s.key] ?? '').toLowerCase().includes(f),
    )
  }, [all, group, filter])

  const dirty = useMemo(
    () =>
      Object.entries(edits).filter(([k, v]) => {
        const orig = all.find((s) => s.key === k)
        return orig ? orig.value !== v : false
      }),
    [edits, all],
  )

  const save = useMutation({
    mutationFn: () => {
      const changed = dirty.map(([key, value]) => ({ key, value }))
      if (changed.length === 0) return Promise.resolve()
      return saveSettings(changed)
    },
    onSuccess: () => {
      message.success(t('设置已保存'))
      setEdits({})
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
    onError: (e) => message.error(e instanceof Error ? e.message : t('保存失败')),
  })


  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <groupDef.icon className="h-4 w-4 text-primary" />
            {t(groupDef.label)} {t('设置')}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {items.length} 项{dirty.length > 0 && ` · ${dirty.length} 项未保存`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="w-52 pl-7 font-mono text-xs"
              placeholder={t("搜索设置项…")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={dirty.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            <SaveIcon className="mr-1.5 h-3.5 w-3.5" />
            {t('保存')}
          </Button>
        </div>
      </div>

      {list.isLoading ? (
        <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-card p-4">
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* index group: build controls + progress */}
          {group === INDEX_GROUP && !filter && <IndexManagement />}

          {/* settings form — 混合布局：短控件双列网格，多行/超长内容占整行 */}
          <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
            {items
              .filter((s) => !(s.key === 's3_access_key_id' || s.key === 's3_secret_access_key'))
              .map((s) => {
                const readonly = s.flag === FLAG_READONLY
                const isPrivate = s.flag === FLAG_PRIVATE
                const edited = edits[s.key] !== undefined && edits[s.key] !== s.value
                const val = edits[s.key] ?? s.value
                const label = t(LABELS[s.key] ?? s.key)
                const full = isFullWidth(s, readonly)
                return (
                  <div
                    key={s.key}
                    className={`p-4 ${full ? 'md:col-span-2' : ''} ${
                      edited
                        ? 'bg-[color-mix(in_srgb,var(--color-primary)_5%,var(--color-card))]'
                        : 'bg-card'
                    }`}
                  >
                    {readonly ? (
                      <div className="flex flex-col gap-1.5">
                        <FieldHeader
                          label={label}
                          itemKey={s.key}
                          isPrivate={isPrivate}
                          readonly
                        />
                        {s.help && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {s.help}
                          </p>
                        )}
                        <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                          {s.value || t('(空)')}
                        </span>
                      </div>
                    ) : s.type === 'bool' ? (
                      /* 开关：左标签右开关的单行紧凑形式 */
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <FieldHeader
                            label={label}
                            itemKey={s.key}
                            isPrivate={isPrivate}
                          />
                          {s.help && (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {s.help}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0">
                          <SettingControl
                            item={s}
                            value={val}
                            onChange={(v) =>
                              setEdits((prev) => ({ ...prev, [s.key]: v }))
                            }
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <FieldHeader
                          label={label}
                          itemKey={s.key}
                          isPrivate={isPrivate}
                        />
                        {s.help && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {s.help}
                          </p>
                        )}
                        <SettingControl
                          item={s}
                          value={val}
                          onChange={(v) =>
                            setEdits((prev) => ({ ...prev, [s.key]: v }))
                          }
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            {items.length === 0 && (
              <div className="p-4 md:col-span-2 md:p-8">
                <EmptyState title={t("没有匹配的设置项")} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
