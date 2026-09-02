/** Shared API types mirroring the Go backend's response models. */

export interface Obj {
  name: string
  size: number
  is_dir: boolean
  modified: string
  sign?: string
  thumb?: string
  type: number
  driver?: string
  /** storage mount path this object lives under (when exposed) */
  storage?: string
  raw_url?: string
  readme?: string
  header?: string
}

export interface FsListResp {
  content: Obj[]
  total: number
  readme: string
  header: string
  write: boolean
  parent?: string
  /** extra fields the backend sometimes includes */
  direct_upload_tools?: string[]
  provider?: string
}

export interface User {
  id: number
  username: string
  password?: string
  base_path: string
  role: number
  disabled: boolean
  permission: number
  sso_id: string
  otp: boolean
  allow_ldap: boolean
}

export interface Storage {
  id: number
  mount_path: string
  driver: string
  order: number
  remark: string
  cache_expiration: number
  status: string
  addition: string
  disabled: boolean

  enable_sign?: boolean
  order_by?: string
  order_direction?: string
}

export interface PublicSettings {
  [key: string]: string
}

export interface SettingItem {
  key: string
  value: string
  help: string
  type: string
  options: string
  group: number
  /** 0=PUBLIC 1=PRIVATE 2=READONLY 3=DEPRECATED */
  flag: number
  index: number
}

/** envelope all /api responses are wrapped in */
export interface Envelope<T> {
  code: number
  message: string
  data: T
}

/** Role values mirror internal/model/user.go: GENERAL=0, GUEST=1, ADMIN=2. */
export const USER_ROLE = {
  GENERAL: 0,
  GUEST: 1,
  ADMIN: 2,
} as const
