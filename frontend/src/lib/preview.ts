/**
 * Preview classification driven by the site settings stored in the database
 * (设置 → 预览): type lists, iframe/external viewers, autoplay flags.
 */
export interface PreviewSettings {
  textTypes: Set<string>
  audioTypes: Set<string>
  videoTypes: Set<string>
  imageTypes: Set<string>
  /** extensions that must be streamed through the /p proxy */
  proxyTypes: Set<string>
  /** "doc,docx,xls" → { Microsoft: url, Google: url } */
  iframePreviews: Record<string, Record<string, string>>
  externalPreviews: Record<string, Record<string, string>>
  videoAutoplay: boolean
  audioAutoplay: boolean
  audioCover: string
}

const csv = (v: string | undefined): Set<string> =>
  new Set(
    (v ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )

const viewers = (v: string | undefined): Record<string, Record<string, string>> => {
  if (!v) return {}
  try {
    const parsed = JSON.parse(v)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function parsePreviewSettings(map: Record<string, string>): PreviewSettings {
  return {
    textTypes: csv(map.text_types),
    audioTypes: csv(map.audio_types),
    videoTypes: csv(map.video_types),
    imageTypes: csv(map.image_types),
    proxyTypes: csv(map.proxy_types),
    iframePreviews: viewers(map.iframe_previews),
    externalPreviews: viewers(map.external_previews),
    videoAutoplay: map.video_autoplay === 'true',
    audioAutoplay: map.audio_autoplay === 'true',
    audioCover: map.audio_cover ?? '',
  }
}

export type PreviewKind = 'video' | 'audio' | 'image' | 'text' | 'iframe'

export interface PreviewMatch {
  kind: PreviewKind
  /** for iframe: viewer name → url template (with $e_url) */
  viewers?: Record<string, string>
}

export function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** Match a file name against the configured preview types. */
export function matchPreview(name: string, s: PreviewSettings): PreviewMatch | null {
  const e = ext(name)
  if (!e) return null
  if (s.videoTypes.has(e)) return { kind: 'video' }
  if (s.audioTypes.has(e)) return { kind: 'audio' }
  if (s.imageTypes.has(e)) return { kind: 'image' }
  if (s.textTypes.has(e)) return { kind: 'text' }
  for (const [group, viewers] of Object.entries(s.iframePreviews)) {
    if (csv(group).has(e)) return { kind: 'iframe', viewers }
  }
  for (const [group, viewers] of Object.entries(s.externalPreviews)) {
    if (csv(group).has(e)) return { kind: 'iframe', viewers }
  }
  return null
}

/** Build an iframe viewer URL: replace $e_url with the encoded target. */
export function buildViewerUrl(template: string, targetUrl: string): string {
  return template.replace('$e_url', encodeURIComponent(targetUrl))
}
