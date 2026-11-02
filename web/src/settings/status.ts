// What the Settings pages say about themselves: the one line under a page's title, and the line under each section on a phone.
import { useAbout } from '../api/about'
import { useStatus } from '../api/attention'
import { useAuth, usePluginInstances, useProfiles, useSettings } from '../api/queries'
import { usePlexSignIn } from '../api/plex'
import { plural } from '../format'

export type Line = { text: string; warn: boolean }

const languageNames = { en: 'English', de: 'German', fr: 'French' } as const

/** Indexers that are failing: Health says so, or their latest check did. */
function useFailingIndexers() {
  const status = useStatus()
  const instances = usePluginInstances()
  const failing = new Set<string>()
  for (const i of status.data?.indexers ?? []) if (i.state === 'failing') failing.add(i.name)
  for (const i of instances.data ?? []) if (i.contract === 'indexer.v1' && i.enabled && i.last_check && !i.last_check.ok) failing.add(i.name)
  return failing
}

/** The pages' one-line summaries: what the page holds, and any problem. */
export function usePageSummaries(): Record<string, string> {
  const status = useStatus()
  const failing = useFailingIndexers()
  const problems = [
    status.data?.download_client.state === 'failing' ? 'The download client needs attention.' : null,
    failing.size > 0 ? `${plural(failing.size, 'indexer')} ${failing.size === 1 ? 'needs' : 'need'} attention.` : null,
  ].filter(Boolean)
  return {
    general: 'Language, how screens start, and updates.',
    'slots-profiles': 'The Slots a Title can have a Version in, what each Profile accepts and which ones new Titles get.',
    library: 'Where files go, existing files Kestrel can take over, and the keys used to look Titles up.',
    downloads: ['Where Kestrel finds releases and where it sends them.', ...problems].join(' '),
    'media-servers': 'The servers Kestrel tells about new files, and Watch-ahead for Silo.',
    account: 'Your password, sessions and API key.',
    access: 'Who may sign in and which proxies Kestrel trusts.',
    about: 'Version, licence and keyboard shortcuts.',
  }
}

/** The line under each section of the phone's list. */
export function useSectionLines(): Record<string, Line> {
  const settings = useSettings()
  const profiles = useProfiles()
  const status = useStatus()
  const instances = usePluginInstances()
  const auth = useAuth()
  const plex = usePlexSignIn()
  const about = useAbout()
  const failing = useFailingIndexers()
  const none: Line = { text: '', warn: false }
  const out: Record<string, Line> = {}

  if (settings.data) {
    const l = settings.data.language_region
    out.general = {
      text: `${languageNames[l.primary_language]} · ${l.release_date_country} · ${settings.data.display.season_order === 'newest_first' ? 'newest' : 'oldest'} season first`,
      warn: false,
    }
    const n = settings.data.root_folders.movies.length + settings.data.root_folders.series.length
    const low = status.data?.disks.some((d) => d.free_bytes < d.low_free_bytes)
    out.library = { text: `${plural(n, 'root folder')}${low ? ' · low disk space' : ''}`, warn: !!low }
  }
  if (profiles.data) {
    const names = [...new Set(profiles.data.filter((p) => p.default_movies || p.default_series).map((p) => p.name))]
    out['slots-profiles'] = { text: names.length > 0 ? `${names.join(' and ')} in use` : 'No defaults', warn: false }
  }
  if (status.data || instances.data) {
    const client = status.data?.download_client
    if (client?.state === 'failing') out.downloads = { text: `${client.name ?? 'Download client'} failing${client.message ? `: ${client.message}` : ''}`, warn: true }
    else if (failing.size > 0) {
      const first = status.data?.indexers.find((i) => i.state === 'failing')
      const name = [...failing][0]
      out.downloads = { text: `${name} failing${first?.message && first.name === name ? `: ${first.message}` : ''}`, warn: true }
    } else
      out.downloads = {
        text: client?.state === 'ok' ? `${client.name} · ${plural((instances.data ?? []).filter((i) => i.contract === 'indexer.v1' && i.enabled).length, 'indexer')}` : 'No download client',
        warn: client?.state === 'none',
      }
  }
  if (instances.data) {
    const media = instances.data.filter((i) => i.contract === 'media_server.v1')
    const bad = media.filter((i) => i.enabled && i.last_check && !i.last_check.ok)
    out['media-servers'] =
      bad.length > 0
        ? { text: `${bad[0].name} not answering`, warn: true }
        : { text: media.length === 0 ? 'None set up' : media.length === 1 ? `${media[0].name} connected` : plural(media.length, 'media server'), warn: false }
  }
  if (auth.data?.state === 'ok') out.account = { text: auth.data.me.username ?? '', warn: false }
  if (plex.data) out.access = { text: plex.data.enabled ? 'Plex sign-in on' : 'Plex sign-in off', warn: false }
  if (about.data)
    out.about = status.data?.update
      ? { text: `Kestrel ${about.data.version} · ${status.data.update.version} available`, warn: true }
      : { text: `Kestrel ${about.data.version} · up to date`, warn: false }
  for (const id of ['general', 'slots-profiles', 'library', 'downloads', 'media-servers', 'account', 'access', 'about']) out[id] ??= none
  return out
}
