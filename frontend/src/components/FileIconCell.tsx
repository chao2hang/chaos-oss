import type { LucideIcon } from 'lucide-react'
import { getFileType, FILE_ICONS, FILE_COLORS } from '../lib/fileIcons'
import type { Obj } from '../api/types'

/**
 * Icon cell for file-listing rows. All icon + color decisions live in
 * `src/lib/fileIcons.ts` — keep this component purely presentational.
 */
export function FileIconCell({
  obj,
  className = 'h-4 w-4',
}: {
  obj: Obj
  className?: string
}) {
  const type = getFileType(obj.name, obj.is_dir)
  const Icon: LucideIcon = FILE_ICONS[type] ?? FILE_ICONS.unknown
  return <Icon className={`shrink-0 ${className} ${FILE_COLORS[type]}`} />
}
