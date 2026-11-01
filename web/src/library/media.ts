/** What a parse or probe knows about a file's or Release's video and audio; each is left out when unknown. */
export type MediaFacts = {
  quality?: string | null
  video_codec?: string | null
  hdr?: string | null
  audio_codec?: string | null
  audio_channels?: string | null
  languages?: string[]
}

/** A quality name as people write it: "WEBDL-1080p" is "WEB-DL 1080p", "Bluray-2160p" is "BluRay 2160p". */
export function qualityName(quality: string): string {
  return quality
    .replace(/^WEBDL/i, 'WEB-DL')
    .replace(/^Bluray/i, 'BluRay')
    .replace(/-(\d{3,4}p)$/i, ' $1')
}

/** "DD 5.1", "DTS-HD MA 7.1"; just the codec when the layout is unknown, "" when the codec is. */
export function audioFormat(m: MediaFacts): string {
  return m.audio_codec ? [m.audio_codec, m.audio_channels].filter(Boolean).join(' ') : ''
}

/** "WEB-DL 1080p · H.264", with the HDR format after the codec when `withHdr`; "" without a quality. */
export function qualityLine(m: MediaFacts, withHdr = true): string {
  if (!m.quality) return ''
  return [qualityName(m.quality), m.video_codec, withHdr ? m.hdr : null].filter(Boolean).join(' · ')
}

/** "DD 5.1 · English": the audio format, then the languages; "" when neither is known. */
export function audioLine(m: MediaFacts): string {
  return [audioFormat(m), m.languages?.join(', ')].filter(Boolean).join(' · ')
}
