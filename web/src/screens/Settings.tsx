import { Button, Entity, Input, NavItem, NavList, Note, StatusDot, Snippet, Textarea, Toggle, Code } from '@hyprsh/design'
import { ArrowDownToLine, BadgeCheck, ChevronRight, Folder, Info, Search, Shield, SlidersHorizontal, Tv, User } from 'lucide-react'
import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { usePhone } from '../responsive'
import { PanelContent, SidePanel } from '../layout/SidePanel'
import { SettingRow, SettingRowBody, SettingsCard, SettingsHeader, SettingsSection } from '../layout/SettingsPage'
import { useStatus } from '../api/attention'
import { healthOf } from '../health/tiles'
import { PhoneBackHeader } from '../layout/PhoneBackHeader'
import { adoptionLabel, useAdoption } from '../api/adoption'
import { ApiError, useApiKey, useAuth, useChangePassword, useCreateApiKey, useLogout, useLogoutEverywhere, useReverseProxy, useSaveReverseProxy, type ReverseProxy } from '../api/queries'
import { About } from '../about/About'
import { AutomaticGrabsRow } from '../grabs/PauseGrabs'
import { DownloadClientSection } from '../plugins/DownloadClientSection'
import { IndexerSection } from '../plugins/IndexerSection'
import { MediaServers } from '../plugins/MediaServers'
import { ProviderKeysForm } from '../metadata/ProviderKeys'
import { TrashForm } from '../trash/Trash'
import { RootFoldersForm } from '../rootfolders/RootFolders'
import { PlexSignInForm } from './PlexSignIn'
import { SiloSettingsForm } from './SiloSettings'
import { ProfilesSection } from '../profiles/ProfilesSection'
import { SlotsSection } from '../slots/SlotsSection'
import { DisplayRows, LanguageRows, SetupRow, UpdatesRow } from '../settings/GeneralRows'
import { DraftProvider, guardLeave, useDraftForm } from '../settings/draft'
import { useSectionLines, usePageSummaries, type Line } from '../settings/status'
import { SkeletonForm } from '../loading'

/** A sub-section: what was once a section of its own. Its id stays the anchor ("#settings-<id>", "/settings/<id>"); `rows` are the titles of the Rows in it, for "Find a setting". */
type Part = { id: string; title: string; rows: string[] }
type Page = { id: string; title: string; group: string; icon: ReactNode; parts: Part[] }

/** Settings pages, in order (the phone's list), each in the group the desktop panel files it under. */
const pages: Page[] = [
  {
    id: 'general',
    title: 'General',
    group: 'General',
    icon: <SlidersHorizontal />,
    parts: [
      { id: 'language', title: 'Language', rows: ['Primary language', 'Country'] },
      { id: 'display', title: 'Display', rows: ['Season order', 'Manual search sort', 'Upcoming shows', 'Wanted only', 'Hide imported'] },
      { id: 'updates', title: 'Updates', rows: ['Check GitHub daily'] },
      { id: 'setup', title: 'Setup', rows: ['Setup wizard'] },
    ],
  },
  {
    id: 'slots-profiles',
    title: 'Slots & Profiles',
    group: 'General',
    icon: <BadgeCheck />,
    parts: [
      { id: 'slots', title: 'Slots', rows: ['Slots', 'Add Slot', 'Slot label'] },
      { id: 'profiles', title: 'Profiles', rows: ['Defaults per Slot', 'Profiles'] },
      { id: 'trash', title: 'TRaSH', rows: ['Custom Formats and profiles'] },
    ],
  },
  {
    id: 'library',
    title: 'Library',
    group: 'General',
    icon: <Folder />,
    parts: [
      { id: 'root-folders', title: 'Root folders', rows: ['Folders'] },
      { id: 'adoption', title: 'Existing files', rows: ['Adopt existing library'] },
      { id: 'metadata', title: 'Provider keys', rows: ['TMDB and TheTVDB'] },
    ],
  },
  {
    id: 'downloads',
    title: 'Downloads',
    group: 'Connections',
    icon: <ArrowDownToLine />,
    parts: [
      { id: 'download-client', title: 'Download client', rows: [] },
      { id: 'indexers', title: 'Indexers', rows: [] },
      { id: 'grabs', title: 'Automatic Grabs', rows: ['Grab automatically'] },
    ],
  },
  {
    id: 'media-servers',
    title: 'Media servers',
    group: 'Connections',
    icon: <Tv />,
    parts: [
      { id: 'media-servers', title: 'Media servers', rows: [] },
      { id: 'silo', title: 'Silo', rows: ['Watch-ahead', 'Silo instance'] },
    ],
  },
  {
    id: 'account',
    title: 'Account',
    group: 'System',
    icon: <User />,
    parts: [
      { id: 'account', title: 'Account', rows: ['Password', 'Sessions'] },
      { id: 'security', title: 'API key', rows: ['Full-access key', 'API key'] },
    ],
  },
  {
    id: 'access',
    title: 'Security & Access',
    group: 'System',
    icon: <Shield />,
    parts: [
      { id: 'plex', title: 'Plex sign-in', rows: ['Let people sign in', 'Plex sign-in'] },
      { id: 'reverse-proxy', title: 'Reverse proxy', rows: ['Header login', 'Trusted proxies', 'Header', 'Reverse proxy'] },
    ],
  },
  {
    id: 'about',
    title: 'About',
    group: 'System',
    icon: <Info />,
    parts: [{ id: 'about', title: 'About', rows: ['Version', 'Licence', 'Update', 'Keyboard shortcuts'] }],
  },
]
const groups = ['General', 'Connections', 'System']

/** The page and the Part an address names: a page's id ("downloads"), or any Part's old section id ("indexers"). */
function resolve(id: string | undefined): { page: Page; part?: Part } | undefined {
  if (!id) return undefined
  for (const page of pages) {
    const part = page.parts.find((p) => p.id === id)
    if (part) return { page, part }
  }
  const page = pages.find((p) => p.id === id)
  return page ? { page } : undefined
}

/** The pages whose Health check fails or warns: the download client or an indexer (Downloads), a low disk (Library). */
function useAttentionSections(): Set<string> {
  const status = useStatus()
  const out = new Set<string>()
  if (!status.data) return out
  for (const t of healthOf(status.data).groups.flatMap((g) => g.tiles)) {
    if (t.tone === 'failing' && (t.key === 'client' || t.key.startsWith('indexer-'))) out.add('downloads')
    else if (t.tone === 'low') out.add('library')
  }
  return out
}

/** The id a "#settings-<id>" address names, if it names a page or a Part. */
const hashId = () => {
  const id = location.hash.startsWith('#settings-') ? location.hash.slice('#settings-'.length) : ''
  return resolve(id) ? id : undefined
}

/** The Part's anchor id, "settings-<id>": the page's own for the Part that shares its id. */
const anchorOf = (id: string) => document.getElementById(`settings-${id}`)

/** Opens a page: its heading takes focus (or the Part's anchor scrolls into view) and the address keeps the place, rather than the base URL's Overview. */
function openSectionLink(event: MouseEvent<Element>, id: string, open: (id: string) => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  const href = (event.currentTarget as HTMLAnchorElement).href
  guardLeave(() => {
    open(id)
    history.replaceState(history.state, '', href)
    // The page renders on the next paint.
    setTimeout(() => {
      const r = resolve(id)
      if (r) document.getElementById(`settings-${r.page.id}-title`)?.focus()
    }, 0)
  })
}

/** Scrolls to a Part of the open page once it has rendered. */
function useScrollToPart(target: string | undefined, pageId: string | undefined) {
  useEffect(() => {
    if (!target || target === pageId) return
    anchorOf(target)?.scrollIntoView?.()
  }, [target, pageId])
}

/**
 * A panel of pages on the left and the open page beside it (the first until one is chosen). On a phone the list is a
 * screen of its own, each section with a line of status under it, and a page another, full screen with a Back button:
 * `section` is the open one ("" is the list), kept by the Shell in the address bar so the browser's Back returns to the list.
 * A page or any old section id names a place.
 */
export function Settings({
  onRunSetup,
  onAdopt,
  section = '',
  onOpenSection,
  onCloseSection,
}: {
  onRunSetup: () => void
  onAdopt: () => void
  section?: string
  onOpenSection?: (id: string) => void
  onCloseSection?: () => void
}) {
  const phone = usePhone()
  const adoption = useAdoption()
  const summaries = usePageSummaries()
  const lines = useSectionLines()
  const content: Record<string, ReactNode> = {
    language: <LanguageRows />,
    display: <DisplayRows />,
    updates: <UpdatesRow />,
    setup: <SetupRow onRunSetup={onRunSetup} />,
    profiles: <ProfilesSection />,
    trash: (
      <SettingsCard>
        <SettingRow
          label="Custom Formats and profiles"
          stacked
          help="Kestrel scores Releases with TRaSH's Custom Formats. It checks daily and takes the newest set whole, after re-scoring every file under it."
        >
          <TrashForm />
        </SettingRow>
      </SettingsCard>
    ),
    'root-folders': (
      <SettingsCard>
        <SettingRow label="Folders" stacked help="Where Imports put Movies and Series. The first of each kind is the default when adding a Title.">
          <RootFoldersForm compact />
        </SettingRow>
      </SettingsCard>
    ),
    slots: <SlotsSection />,
    adoption: (
      <SettingsCard>
        <SettingRow label="Adopt existing library" help="Scan the Movie and Series Root folders for files Kestrel does not manage yet and take them over without downloading again.">
          <Button size="small" onClick={onAdopt}>
            {adoptionLabel(adoption.data?.state)}
          </Button>
        </SettingRow>
      </SettingsCard>
    ),
    metadata: (
      <SettingsCard>
        <SettingRow label="TMDB and TheTVDB" stacked help="Kestrel looks Titles up with the project's own keys. Enter your own to use them instead; they are never shown again.">
          <ProviderKeysForm />
        </SettingRow>
      </SettingsCard>
    ),
    'download-client': <DownloadClientSection />,
    indexers: <IndexerSection />,
    grabs: <AutomaticGrabsRow />,
    'media-servers': <MediaServers />,
    silo: <SiloSettingsForm />,
    account: (
      <SettingsCard>
        <LogOut />
        <ChangePassword />
        <LogOutEverywhere />
      </SettingsCard>
    ),
    security: <ApiKeyRow />,
    plex: (
      <SettingsCard>
        <PlexSignInRow />
      </SettingsCard>
    ),
    'reverse-proxy': <ReverseProxyRow />,
    about: <About />,
  }

  if (phone) {
    const open = resolve(section)
    if (open)
      return (
        <div key={open.page.id} className="flex min-h-0 flex-1 flex-col">
          <PhoneBackHeader onBack={() => guardLeave(() => onCloseSection?.())}>{open.page.title}</PhoneBackHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <PageView page={open.page} content={content} summary={summaries[open.page.id]} target={open.part?.id} headingHidden />
          </div>
        </div>
      )
    return <PhoneList lines={lines} onOpen={(id) => onOpenSection?.(id)} />
  }

  return <DesktopSettings content={content} summaries={summaries} initial={section} />
}

/** The phone's list: "Find a setting", then the sections in their groups, each with a line of status under it (amber when it needs attention). */
function PhoneList({ lines, onOpen }: { lines: Record<string, Line>; onOpen: (id: string) => void }) {
  const [find, setFind] = useState('')
  const matches = findPages(find)
  return (
    <div key="list" className="flex min-h-0 flex-1 flex-col">
      <SidePanel title="Settings" filter={<FindField value={find} onChange={setFind} onEnter={() => matches[0] && onOpen(matches[0].part?.id ?? matches[0].page.id)} />} />
      <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-auto">
        {matches.length === 0 && <p className="label-13 px-4 py-3 text-gray-900">No setting matches “{find.trim()}”.</p>}
        {groups.map((g) => {
          const inGroup = matches.filter(({ page }) => page.group === g)
          if (inGroup.length === 0) return null
          return (
            <section key={g} aria-label={g}>
              <h2 className="label-12 px-4 pt-3.5 pb-1.5 text-gray-900">{g}</h2>
              <Entity.List>
                {inGroup.map(({ page, part, note }) => {
                  const line = lines[page.id]
                  return (
                    <Entity key={page.id} as="button" left={page.icon} right={<ChevronRight aria-hidden className="size-4 text-gray-900" />} onClick={() => onOpen(part?.id ?? page.id)}>
                      <Entity.Content fill title={page.title} description={note ?? (line?.text ? <span className={line.warn ? 'text-amber-900' : ''}>{line.text}</span> : undefined)} />
                    </Entity>
                  )
                })}
              </Entity.List>
            </section>
          )
        })}
      </nav>
    </div>
  )
}

type Match = { page: Page; part: Part | undefined; note: string | undefined }

/** The pages a "Find a setting" text names: a page's title, or one of its Parts or Rows. All of them without a text. */
function findPages(find: string): Match[] {
  const needle = find.trim().toLowerCase()
  return pages
    .map((page): Match | undefined => {
      if (!needle || page.title.toLowerCase().includes(needle)) return { page, part: undefined, note: undefined }
      for (const part of page.parts) {
        const hit = [part.title, ...part.rows].find((t) => t.toLowerCase().includes(needle))
        if (hit) return { page, part, note: hit }
      }
      return undefined
    })
    .filter((m) => m !== undefined)
}

function FindField({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  return (
    <Input
      size="small"
      aria-label="Find a setting"
      placeholder="Find a setting"
      type="search"
      prefix={<Search aria-hidden className="size-4" />}
      prefixStyling={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEnter()
        } else if (e.key === 'Escape') onChange('')
      }}
    />
  )
}

function DesktopSettings({ content, summaries, initial }: { content: Record<string, ReactNode>; summaries: Record<string, string>; initial: string }) {
  // The open place: a page's id or a Part's old id, which opens its page and scrolls to it.
  const [open, setOpen] = useState(resolve(initial) ? initial : (hashId() ?? pages[0].id))
  const [find, setFind] = useState('')
  const attention = useAttentionSections()
  // A place opened from elsewhere ("/settings/indexers"), or the address changing under us.
  useEffect(() => {
    if (resolve(initial)) setOpen(initial)
  }, [initial])
  useEffect(() => {
    const onHash = () => {
      const id = hashId()
      if (id) guardLeave(() => setOpen(id))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const matches = findPages(find)
  const choose = (id: string) => {
    setOpen(id)
    setFind('')
  }
  const current = resolve(open)!

  return (
    <div className="flex min-h-0 flex-1">
      <SidePanel
        title="Settings"
        filter={
          <FindField
            value={find}
            onChange={setFind}
            onEnter={() => {
              if (!matches[0]) return
              const id = matches[0].part?.id ?? matches[0].page.id
              guardLeave(() => {
                choose(id)
                history.replaceState(history.state, '', `${location.pathname}#settings-${id}`)
              })
            }}
          />
        }
        views={
          <NavList aria-label="Settings sections">
            {matches.length === 0 && <p className="label-13 px-2.5 py-2 text-gray-900">No setting matches “{find.trim()}”.</p>}
            {groups.map((g) => {
              const inGroup = matches.filter(({ page }) => page.group === g)
              if (inGroup.length === 0) return null
              return (
                <NavList.Group key={g} title={g}>
                  {inGroup.map(({ page, part, note }) => (
                    <NavItem
                      key={page.id}
                      href={`${location.pathname}#settings-${part?.id ?? page.id}`}
                      current={page.id === current.page.id ? 'true' : false}
                      trailing={attention.has(page.id) ? <StatusDot state="warning" label={false} /> : undefined}
                      trailingLabel={attention.has(page.id) ? 'Needs attention' : undefined}
                      icon={page.icon}
                      onClick={(e) => openSectionLink(e, part?.id ?? page.id, choose)}
                    >
                      {note ? (
                        <span className="min-w-0">
                          <span className="block truncate">{page.title}</span>
                          <span className="label-12 block truncate font-normal text-gray-900">{note}</span>
                        </span>
                      ) : (
                        page.title
                      )}
                    </NavItem>
                  ))}
                </NavList.Group>
              )
            })}
          </NavList>
        }
      />
      <PanelContent reading>
        <div key={current.page.id}>
          <PageView page={current.page} content={content} summary={summaries[current.page.id]} target={current.part?.id} />
        </div>
      </PanelContent>
    </div>
  )
}

/** A page: its title and summary, then each Part as an anchored section of cards. The page's draft (its Save bar) lives here. `target` is the Part to scroll to. */
function PageView({ page, content, summary, target, headingHidden }: { page: Page; content: Record<string, ReactNode>; summary: string; target?: string; headingHidden?: boolean }) {
  useScrollToPart(target, page.id)
  return (
    <section id={`settings-${page.id}`} aria-labelledby={`settings-${page.id}-title`} className="mb-8">
      <SettingsHeader id={`settings-${page.id}-title`} title={page.title} summary={summary} hideTitle={headingHidden} />
      <DraftProvider>
        <div className="flex flex-col gap-7">
          {page.parts.map((part) =>
            part.id === page.id ? (
              <div key={part.id} className="flex flex-col gap-2.5">
                {content[part.id]}
              </div>
            ) : (
              <SettingsSectionPart key={part.id} id={`settings-${part.id}`} title={part.title}>
                {content[part.id]}
              </SettingsSectionPart>
            ),
          )}
        </div>
      </DraftProvider>
    </section>
  )
}

/** A Part with its own heading, unless its content brings one (the download client and indexers draw theirs). */
function SettingsSectionPart({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const own = id === 'settings-download-client' || id === 'settings-indexers' || id === 'settings-slots'
  return <div id={id}>{own ? children : <SettingsSection title={title}>{children}</SettingsSection>}</div>
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const change = useChangePassword()
  const auth = useAuth()
  const declared = auth.data?.state === 'ok' && auth.data.me.from_config_file

  const submit = (e: FormEvent) => {
    e.preventDefault()
    change.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          setCurrent('')
          setNext('')
        },
      },
    )
  }

  return (
    <SettingRow label="Password" stacked help="At least 8 characters. Changing it logs out every other session.">
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
        <fieldset disabled={declared} className="contents">
          <Input size="small" label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input size="small" label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {change.isError && (
            <Note variant="error" size="small">
              {change.error instanceof ApiError && change.error.status === 422 ? change.error.message : 'Could not change the password. Try again.'}
            </Note>
          )}
          {change.isSuccess && (
            <Note variant="success" size="small">
              Password changed. Other sessions were logged out.
            </Note>
          )}
          <Button size="small" variant="primary" typeName="submit" disabled={change.isPending || !current || !next} className="self-start">
            Change password
          </Button>
        </fieldset>
        {declared && <Note size="small">The Config File sets the account, so its password cannot be changed here. Change the file and restart Kestrel instead.</Note>}
      </form>
    </SettingRow>
  )
}

/** Ends this browser's session; not offered to a session the proxy or the Config File opened, as the rail's button was not. */
function LogOut() {
  const auth = useAuth()
  const logout = useLogout()
  if (!(auth.data?.state === 'ok' && auth.data.me.method === 'session')) return null
  return (
    <SettingRow label="Log Out" help="Ends this session. Other sessions stay.">
      <Button size="small" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}>
        Log Out
      </Button>
    </SettingRow>
  )
}

function LogOutEverywhere() {
  const logout = useLogoutEverywhere()
  return (
    <SettingRow label="Sessions" help="Ends every session, including this one.">
      <Button size="small" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}>
        Log Out Everywhere
      </Button>
    </SettingRow>
  )
}

function ApiKeyRow() {
  const info = useApiKey()
  const create = useCreateApiKey()
  const [shown, setShown] = useState<string | null>(null)
  const exists = !!info.data?.prefix
  const fromEnv = !!info.data?.from_environment

  const generate = () => create.mutate(undefined, { onSuccess: setShown })

  return (
    <SettingsCard>
      <SettingRow label="Full-access key" stacked help="One full-access key for scripts and the Silo plugin, sent as the X-Api-Key header. Kestrel keeps only a hash of it.">
        <div className="flex max-w-lg flex-col gap-3">
          {shown ? (
            <div className="flex flex-col gap-2">
              <p className="copy-13 text-gray-900">This is the only time the key is shown. Copy it now.</p>
              <Snippet prompt={false} text={shown} />
              <Button size="small" variant="primary" onClick={() => setShown(null)} className="self-start">
                Done
              </Button>
            </div>
          ) : (
            <>
              {info.data && (
                <p className="copy-13">
                  {exists ? (
                    <>
                      <Code>{info.data.prefix}…</Code>, {fromEnv ? 'set from the environment' : `created ${new Date(info.data.created_at ?? '').toLocaleDateString()}`}
                    </>
                  ) : (
                    <span className="text-gray-900">No API key yet.</span>
                  )}
                </p>
              )}
              {create.isError && (
                <Note variant="error" size="small">
                  Could not generate a key. Try again.
                </Note>
              )}
              <Button size="small" variant={exists ? 'secondary' : 'primary'} disabled={create.isPending || !info.data || fromEnv} onClick={generate} className="self-start">
                {exists ? 'Rotate API key' : 'Generate API key'}
              </Button>
              {fromEnv ? (
                <p className="copy-13 text-gray-900">
                  The <Code>KESTREL_API_KEY</Code> environment variable sets this key, so it cannot be rotated here. Change the variable and restart Kestrel instead.
                </p>
              ) : (
                exists && <p className="copy-13 text-gray-900">Rotating stops the old key at once.</p>
              )}
            </>
          )}
        </div>
      </SettingRow>
    </SettingsCard>
  )
}

function ReverseProxyRow() {
  const { data } = useReverseProxy()
  return data ? <ReverseProxyForm saved={data} /> : <SkeletonForm rows={2} />
}

function PlexSignInRow() {
  return (
    <SettingRow
      label="Let people sign in"
      stacked
      help="Let the people you share your Plex server with sign in with their Plex account to search for Titles, make Requests and follow their own. They can reach nothing else."
    >
      <PlexSignInForm />
    </SettingRow>
  )
}

/** Reverse proxy: three settings kept as a draft and saved with the page's one Save bar. */
function ReverseProxyForm({ saved }: { saved: ReverseProxy }) {
  const save = useSaveReverseProxy()
  const { draft, set, dirty } = useDraftForm({
    id: 'reverse-proxy',
    saved: { enabled: saved.enabled, trusted: saved.trusted_proxies.join('\n'), header: saved.header },
    labels: { enabled: 'Header login', trusted: 'Trusted proxies', header: 'Header' },
    commit: (d) =>
      save.mutateAsync({
        enabled: d.enabled,
        trusted_proxies: d.trusted
          .split(/[\s,]+/)
          .map((p) => p.trim())
          .filter(Boolean),
        header: d.header.trim(),
      }),
  })
  const off = saved.from_config_file
  return (
    <>
      <SettingsCard>
        <SettingRow
          label="Header login"
          dirty={dirty('enabled')}
          help="Log in from the header below, from a trusted proxy (needs one). For an SSO portal; it is off by default and the login form stays as a fallback."
        >
          <Toggle aria-label="Log in from the header, from a trusted proxy" checked={draft.enabled} disabled={off} onChange={(enabled) => set({ enabled })} />
        </SettingRow>
        <SettingRow
          label="Trusted proxies"
          dirty={dirty('trusted')}
          help="The proxies in front of Kestrel, so it sees each client's own address for the login throttle and the Secure cookie. One address or range per line."
        >
          <Textarea aria-label="Trusted proxies" rows={3} value={draft.trusted} disabled={off} onChange={(e) => set({ trusted: e.target.value })} placeholder={'172.18.0.0/16\n10.0.0.5'} mono />
        </SettingRow>
        <SettingRow label="Header" dirty={dirty('header')} help="The request header that carries the signed-in user's name.">
          <Input size="small" aria-label="Header" value={draft.header} disabled={off} onChange={(e) => set({ header: e.target.value })} />
          {save.isError && (
            <SettingRowBody>
              <Note variant="error" size="small">
                {save.error instanceof ApiError && save.error.status === 422 ? save.error.message : 'Could not save. Try again.'}
              </Note>
            </SettingRowBody>
          )}
        </SettingRow>
      </SettingsCard>
      {saved.from_config_file && <Note size="small">The Config File sets the reverse proxy, so it cannot be changed here. Change the file and restart Kestrel instead.</Note>}
      {saved.untrusted.length > 0 && (
        <section aria-label="Untrusted proxy header sightings">
          <Note variant="warning" size="small">
            <p className="mb-1 font-medium">The header came from addresses that are not trusted proxies, so it was ignored:</p>
            <ul className="flex flex-col gap-0.5">
              {saved.untrusted.map((u) => (
                <li key={u.ip} className="font-mono">
                  {u.ip} sent “{u.value}” {u.count} time
                  {u.count === 1 ? '' : 's'}, last {new Date(u.last_seen).toLocaleString()}
                </li>
              ))}
            </ul>
          </Note>
        </section>
      )}
    </>
  )
}
