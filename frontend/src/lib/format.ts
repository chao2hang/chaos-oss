/** Formatting helpers shared across pages.
 *
 * File-type classification + icons live in `src/lib/fileIcons.ts`.
 */

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}

export function formatTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

/** Split "/a/b/c" into navigable segments. */
export function pathSegments(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  const out: { name: string; path: string }[] = [{ name: '~', path: '/' }]
  let acc = ''
  for (const p of parts) {
    acc += `/${p}`
    out.push({ name: p, path: acc })
  }
  return out
}

/** Join dir + name safely. */
export function joinPath(dir: string, name: string): string {
  if (dir === '/' || dir === '') return `/${name}`
  return `${dir.replace(/\/$/, '')}/${name}`
}

