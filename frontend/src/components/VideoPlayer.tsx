import { useEffect, useRef } from 'react'
import Player from 'xgplayer'
import HlsPlugin from 'xgplayer-hls'
import 'xgplayer/dist/index.min.css'
import { useI18n } from '../i18n'

/**
 * 西瓜播放器 (xgplayer) wrapper.
 * `url` should already be resolved (raw link or /p proxy for m3u8).
 * `subtitle` — a same-origin WebVTT URL (plain .vtt or a converted srt blob).
 */
export default function VideoPlayer({
  url,
  autoplay,
  poster,
  subtitle,
}: {
  url: string
  autoplay?: boolean
  poster?: string
  subtitle?: string
}) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)

  useEffect(() => {
    if (!containerRef.current || !url) return
    const isHls = /\.m3u8($|\?)/i.test(url)
    const player = new Player({
      el: containerRef.current,
      url,
      autoplay,
      poster,
      fluid: true,
      playsinline: true,
      plugins: isHls ? [HlsPlugin] : [],
    })
    playerRef.current = player

    // attach a same-name subtitle track once the video element exists
    const video = player.video as HTMLVideoElement | undefined
    if (subtitle && video && typeof video.appendChild === 'function') {
      try {
        const track = document.createElement('track')
        track.kind = 'subtitles'
        track.label = t('字幕')
        track.srclang = 'zh'
        track.default = true
        track.src = subtitle
        video.appendChild(track)
        // some browsers keep the track in "disabled" until toggled
        const tt = video.textTracks[video.textTracks.length - 1]
        if (tt) tt.mode = 'showing'
      } catch {
        // subtitles are best-effort — playback must not break
      }
    }

    return () => {
      try {
        player.destroy()
      } catch {
        // player already torn down
      }
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, subtitle])

  return <div ref={containerRef} className="mx-auto w-full max-w-4xl" />
}
