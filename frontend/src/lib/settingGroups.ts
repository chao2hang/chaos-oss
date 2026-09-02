/**
 * Setting groups (mirror internal/model/setting.go) with their icons.
 * Shared between the manage sidebar accordion and the settings page header.
 */
import {
  PuzzleIcon,
  GlobeIcon,
  PaletteIcon,
  EyeIcon,
  SlidersHorizontalIcon,
  CloudDownloadIcon,
  ListTreeIcon,
  KeyRoundIcon,
  IdCardIcon,
  ServerIcon,
  ActivityIcon,
  type LucideIcon,
} from 'lucide-react'

export interface SettingGroup {
  id: number
  label: string
  icon: LucideIcon
}

export const SETTING_GROUPS: SettingGroup[] = [
  { id: 0, label: '独立', icon: PuzzleIcon },
  { id: 1, label: '站点', icon: GlobeIcon },
  { id: 2, label: '样式', icon: PaletteIcon },
  { id: 3, label: '预览', icon: EyeIcon },
  { id: 4, label: '全局', icon: SlidersHorizontalIcon },
  { id: 5, label: '离线下载', icon: CloudDownloadIcon },
  { id: 6, label: '索引', icon: ListTreeIcon },
  { id: 7, label: '单点登录', icon: KeyRoundIcon },
  { id: 8, label: 'LDAP', icon: IdCardIcon },
  { id: 10, label: 'FTP', icon: ServerIcon },
  { id: 11, label: '流量', icon: ActivityIcon },
]

export function settingGroup(id: number): SettingGroup {
  return (
    SETTING_GROUPS.find((g) => g.id === id) ?? {
      id,
      label: '其他',
      icon: PuzzleIcon,
    }
  )
}
