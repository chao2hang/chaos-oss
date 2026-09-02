/**
 * Centralized file-icon registry.
 *
 * Single source of truth mapping file extensions → semantic type →
 * (lucide icon, color class). Pages should consume `getFileType` /
 * `FILE_ICONS` / `FILE_COLORS` instead of scattering ad-hoc icon picks.
 */
import {
  FolderIcon,
  FileIcon,
  FileTextIcon,
  FileImageIcon,
  FileVideoIcon,
  FileAudioIcon,
  FileArchiveIcon,
  FileCodeIcon,
  FileJsonIcon,
  FileCogIcon,
  FileTerminalIcon,
  FileSpreadsheetIcon,
  FilePenLineIcon,
  FileKeyIcon,
  FileTypeIcon,
  FileType2Icon,
  PresentationIcon,
  Disc3Icon,
  PackageIcon,
  AppWindowIcon,
  CaptionsIcon,
  MagnetIcon,
  DatabaseIcon,
  Link2Icon,
  type LucideIcon,
} from 'lucide-react'

export type FileType =
  | 'dir'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'markdown'
  | 'code'
  | 'json'
  | 'config'
  | 'shell'
  | 'text'
  | 'archive'
  | 'disk'
  | 'font'
  | 'executable'
  | 'app'
  | 'subtitle'
  | 'torrent'
  | 'database'
  | 'cert'
  | 'link'
  | 'unknown'

/** icon per semantic type */
export const FILE_ICONS: Record<FileType, LucideIcon> = {
  dir: FolderIcon,
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  pdf: FileTextIcon,
  word: FileType2Icon,
  excel: FileSpreadsheetIcon,
  ppt: PresentationIcon,
  markdown: FilePenLineIcon,
  code: FileCodeIcon,
  json: FileJsonIcon,
  config: FileCogIcon,
  shell: FileTerminalIcon,
  text: FileTextIcon,
  archive: FileArchiveIcon,
  disk: Disc3Icon,
  font: FileTypeIcon,
  executable: AppWindowIcon,
  app: PackageIcon,
  subtitle: CaptionsIcon,
  torrent: MagnetIcon,
  database: DatabaseIcon,
  cert: FileKeyIcon,
  link: Link2Icon,
  unknown: FileIcon,
}

/** color class per semantic type (tailwind palette on near-black bg) */
export const FILE_COLORS: Record<FileType, string> = {
  dir: 'text-primary',
  image: 'text-emerald-400',
  video: 'text-violet-400',
  audio: 'text-amber-400',
  pdf: 'text-red-400',
  word: 'text-blue-400',
  excel: 'text-green-400',
  ppt: 'text-orange-400',
  markdown: 'text-sky-400',
  code: 'text-teal-400',
  json: 'text-yellow-400',
  config: 'text-slate-400',
  shell: 'text-lime-400',
  text: 'text-sky-400',
  archive: 'text-orange-400',
  disk: 'text-purple-400',
  font: 'text-pink-400',
  executable: 'text-rose-400',
  app: 'text-cyan-400',
  subtitle: 'text-cyan-300',
  torrent: 'text-blue-400',
  database: 'text-indigo-400',
  cert: 'text-fuchsia-400',
  link: 'text-primary',
  unknown: 'text-muted-foreground',
}

/** extension → semantic type (lowercase, no dot) */
const EXTENSION_MAP: Record<string, FileType> = {
  // images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  bmp: 'image', svg: 'image', ico: 'image', avif: 'image', heic: 'image',
  heif: 'image', tif: 'image', tiff: 'image', psd: 'image', ai: 'image',
  eps: 'image', xcf: 'image', dng: 'image', cr2: 'image', cr3: 'image',
  nef: 'image', arw: 'image', rw2: 'image', orf: 'image', raw: 'image',
  // videos
  mp4: 'video', mkv: 'video', webm: 'video', avi: 'video', mov: 'video',
  flv: 'video', f4v: 'video', m4v: 'video', ts: 'video', m2ts: 'video',
  mts: 'video', wmv: 'video', rm: 'video', rmvb: 'video', mpg: 'video',
  mpeg: 'video', '3gp': 'video', '3g2': 'video', vob: 'video', ogv: 'video',
  // audio
  mp3: 'audio', flac: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio',
  m4a: 'audio', aac: 'audio', opus: 'audio', wma: 'audio', ape: 'audio',
  alac: 'audio', aiff: 'audio', aif: 'audio', caf: 'audio', mid: 'audio',
  midi: 'audio', wv: 'audio', dsf: 'audio',
  // documents
  pdf: 'pdf',
  doc: 'word', docx: 'word', docm: 'word', dot: 'word', dotx: 'word',
  rtf: 'word', odt: 'word', pages: 'word', wpd: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', xlsb: 'excel', csv: 'excel',
  tsv: 'excel', ods: 'excel', numbers: 'excel',
  ppt: 'ppt', pptx: 'ppt', pptm: 'ppt', odp: 'ppt',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown', mdown: 'markdown',
  txt: 'text', log: 'text', nfo: 'text',
  // code
  go: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code',
  cjs: 'code', py: 'code', pyw: 'code', rs: 'code', java: 'code', c: 'code',
  cpp: 'code', cc: 'code', cxx: 'code', h: 'code', hpp: 'code', hh: 'code',
  cs: 'code', rb: 'code', php: 'code', kt: 'code', kts: 'code', swift: 'code',
  scala: 'code', dart: 'code', vue: 'code', svelte: 'code', lua: 'code',
  pl: 'code', pm: 'code', r: 'code', m: 'code', mm: 'code', pas: 'code',
  asm: 'code', v: 'code',
  json: 'json', json5: 'json', jsonc: 'json', jsonl: 'json', geojson: 'json',
  // config
  yml: 'config', yaml: 'config', toml: 'config', ini: 'config',
  conf: 'config', cfg: 'config', config: 'config', properties: 'config',
  env: 'config', xml: 'config', plist: 'config', props: 'config',
  // shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell',
  psm1: 'shell', bat: 'shell', cmd: 'shell', command: 'shell',
  // archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
  gz: 'archive', tgz: 'archive', bz2: 'archive', tbz: 'archive',
  xz: 'archive', txz: 'archive', zst: 'archive', br: 'archive',
  lz4: 'archive', lzma: 'archive', ace: 'archive', cab: 'archive',
  jar: 'archive', war: 'archive', ear: 'archive',
  // disk images
  iso: 'disk', img: 'disk', dmg: 'disk', vhd: 'disk', vmdk: 'disk',
  vdi: 'disk', wim: 'disk',
  // fonts
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', eot: 'font',
  fon: 'font', pfb: 'font', pfm: 'font', ttc: 'font',
  // executables / app packages
  exe: 'executable', msi: 'executable', app: 'executable',
  appimage: 'executable', run: 'executable', bin: 'executable',
  com: 'executable', scr: 'executable',
  apk: 'app', ipa: 'app', xapk: 'app', apks: 'app',
  // subtitles
  srt: 'subtitle', ass: 'subtitle', ssa: 'subtitle', vtt: 'subtitle',
  sub: 'subtitle', idx: 'subtitle', sbv: 'subtitle', psub: 'subtitle',
  // torrents
  torrent: 'torrent',
  // databases
  db: 'database', sqlite: 'database', sqlite3: 'database', sql: 'database',
  mdb: 'database', accdb: 'database', dbf: 'database',
  // certs / keys
  pem: 'cert', crt: 'cert', cer: 'cert', key: 'cert', p12: 'cert',
  pfx: 'cert', der: 'cert', gpg: 'cert', pgp: 'cert', sig: 'cert',
  asc: 'cert',
  // shortcuts
  url: 'link', lnk: 'link', website: 'link',
}

/** files matched by full name before the extension kicks in */
const NAME_MAP: Record<string, FileType> = {
  makefile: 'shell',
  dockerfile: 'config',
  cmakelists: 'config',
  '.gitignore': 'config',
  '.dockerignore': 'config',
  '.env': 'config',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
}

export function ext(name: string): string {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return '' // no ext, or dotfile like ".gitignore"
  return name.slice(idx + 1).toLowerCase()
}

/** Resolve the semantic file type of a listing entry. */
export function getFileType(name: string, isDir: boolean): FileType {
  if (isDir) return 'dir'
  const lower = name.toLowerCase()
  if (NAME_MAP[lower]) return NAME_MAP[lower]
  return EXTENSION_MAP[ext(lower)] ?? 'unknown'
}
