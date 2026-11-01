import { Button, Checkbox, Code, Entity, Fieldset, Input, Note, Snippet, Textarea } from '@hyprsh/design'
import { ChevronRight, Search } from 'lucide-react'
import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { usePhone } from '../responsive'
import { JumpGroup, JumpLink, JumpNav } from '../layout/JumpNav'
import { SidePanel } from '../layout/SidePanel'
import { useStatus } from '../api/attention'
import { healthOf } from '../health/tiles'
import { PhoneBackHeader } from '../layout/PhoneBackHeader'
import { adoptionLabel, useAdoption } from '../api/adoption'
import { ApiError, useApiKey, useAuth, useChangePassword, useCreateApiKey, useLogout, useLogoutEverywhere, useReverseProxy, useSaveReverseProxy, type ReverseProxy } from '../api/queries'
import { About } from '../about/About'
import { UpdateCheckSwitch } from '../about/UpdateCheck'
import { PauseGrabsSwitch } from '../grabs/PauseGrabs'
import { DownloadClientRow } from '../plugins/DownloadClient'
import { Indexers } from '../plugins/Indexers'
import { MediaServers } from '../plugins/MediaServers'
import { ProviderKeysForm } from '../metadata/ProviderKeys'
import { TrashForm } from '../trash/Trash'
import { DisplayForm } from '../display/DisplayForm'
import { LanguageForm } from '../profiles/Language'
import { RootFoldersForm } from '../rootfolders/RootFolders'
import { PlexSignInForm } from './PlexSignIn'
import { SiloSettingsForm } from './SiloSettings'
import { DefaultsPerSlot, ProfileToggles } from '../profiles/Profiles'

/** A sub-section: what was once a section of its own. Its id stays the anchor ("#settings-<id>", "/settings/<id>"); `rows` are the titles of the Rows in it, for "Find a setting". */
type Part = { id: string; title: string; rows: string[] }
type Page = { id: string; title: string; group: string; parts: Part[] }

/** Settings pages, in order (the phone's list), each in the group the desktop panel files it under. */
const pages: Page[] = [
  {
    id: 'general',
    title: 'General',
    group: 'General',
    parts: [
      { id: 'language', title: 'Primary Language', rows: ['Language and country'] },
      { id: 'display', title: 'Display', rows: ['Household defaults'] },
      { id: 'updates', title: 'Updates', rows: ['GitHub'] },
      { id: 'setup', title: 'Setup', rows: ['Setup wizard'] },
    ],
  },
  {
    id: 'profiles',
    title: 'Profiles',
    group: 'General',
    parts: [
      { id: 'profiles', title: 'Profiles', rows: ['Defaults per Slot', 'Profiles'] },
      { id: 'trash', title: 'TRaSH', rows: ['Custom Formats and profiles'] },
    ],
  },
  {
    id: 'library',
    title: 'Library',
    group: 'General',
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
    parts: [
      { id: 'download-client', title: 'Download client', rows: [] },
      { id: 'indexers', title: 'Indexers', rows: [] },
      { id: 'grabs', title: 'Grabs', rows: ['Automatic Grabs'] },
    ],
  },
  {
    id: 'media-servers',
    title: 'Media servers',
    group: 'Connections',
    parts: [
      { id: 'media-servers', title: 'Media servers', rows: [] },
      { id: 'silo', title: 'Silo', rows: ['Watch-ahead'] },
    ],
  },
  {
    id: 'account',
    title: 'Account',
    group: 'System',
    parts: [
      { id: 'account', title: 'Account', rows: ['Password', 'Sessions'] },
      { id: 'security', title: 'API key', rows: ['API key'] },
    ],
  },
  {
    id: 'access',
    title: 'Security & Access',
    group: 'System',
    parts: [
      { id: 'plex', title: 'Plex sign-in', rows: ['Plex sign-in'] },
      { id: 'reverse-proxy', title: 'Reverse proxy', rows: ['Reverse proxy', 'Trusted proxies', 'Header'] },
    ],
  },
  {
    id: 'about',
    title: 'About',
    group: 'System',
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
function openSectionLink(event: MouseEvent<HTMLElement>, id: string, open: (id: string) => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  open(id)
  history.replaceState(history.state, '', (event.currentTarget as HTMLAnchorElement).href)
  // The page renders on the next paint.
  setTimeout(() => {
    const r = resolve(id)
    if (r) document.getElementById(`settings-${r.page.id}-title`)?.focus()
  }, 0)
}

/** Scrolls to a Part of the open page once it has rendered. */
function useScrollToPart(target: string | undefined, pageId: string | undefined) {
  useEffect(() => {
    if (!target || target === pageId) return
    anchorOf(target)?.scrollIntoView?.()
  }, [target, pageId])
}

/**
 * A panel of pages on the left and the open page, titled parts each holding rows, beside it (the first until one is chosen). On a phone the list is a
 * screen of its own and a page another, full screen with a Back button: `section` is the open
 * one ("" is the list), kept by the Shell in the address bar so the browser's Back returns to the list.
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
  const content: Record<string, ReactNode> = {
    language: (
      <Row label="Language and country" help="The household's language and the country whose release dates and age ratings Kestrel reads.">
        <LanguageForm />
      </Row>
    ),
    display: (
      <Row label="Household defaults" help="How every browser starts: the order of a Series' seasons, which seasons are open, and where Manual search and Upcoming begin.">
        <DisplayForm />
      </Row>
    ),
    updates: (
      <Row label="GitHub" help="One switch for the daily release, security advisory and TRaSH checks.">
        <UpdateCheckSwitch />
      </Row>
    ),
    setup: (
      <Row label="Setup wizard" help="Walk through the setup sections again. The account stays as it is.">
        <Button size="small" onClick={onRunSetup}>
          Run setup again
        </Button>
      </Row>
    ),
    profiles: (
      <>
        <Row label="Defaults per Slot" help="The Profile a new Title gets for each Slot. Standard always has one.">
          <DefaultsPerSlot />
        </Row>
        <Row label="Profiles" help="Turn Profiles off or let Primary-Language ones accept the Original Language. Disabling a Profile clears its defaults.">
          <ProfileToggles />
        </Row>
      </>
    ),
    trash: (
      <Row label="Custom Formats and profiles" help="Kestrel scores Releases with TRaSH's Custom Formats. It checks daily and takes the newest set whole, after re-scoring every file under it.">
        <TrashForm />
      </Row>
    ),
    'root-folders': (
      <Row label="Folders" help="Where Imports put Movies and Series. The first of each kind is the default when adding a Title.">
        <RootFoldersForm compact />
      </Row>
    ),
    adoption: (
      <Row label="Adopt existing library" help="Scan the Movie and Series Root folders for files Kestrel does not manage yet and take them over without downloading again.">
        <Button size="small" onClick={onAdopt}>
          {adoptionLabel(adoption.data?.state)}
        </Button>
      </Row>
    ),
    metadata: (
      <Row label="TMDB and TheTVDB" help="Kestrel looks Titles up with the project's own keys. Enter your own to use them instead; they are never shown again.">
        <ProviderKeysForm />
      </Row>
    ),
    'download-client': <DownloadClientRow />,
    indexers: <Indexers />,
    grabs: (
      <Row label="Automatic Grabs" help="Hold Kestrel back, for example after a large Adoption, without disabling the download client or the indexers.">
        <PauseGrabsSwitch />
      </Row>
    ),
    'media-servers': <MediaServers />,
    silo: (
      <Row
        label="Watch-ahead"
        help="Series requested whole in Silo start with season 1, and Kestrel adds the next season once 2 episodes of the newest one have been watched in Plex or Silo. The Kestrel plugin in Silo can override this per request route."
      >
        <SiloSettingsForm />
      </Row>
    ),
    account: (
      <>
        <LogOut />
        <ChangePassword />
        <LogOutEverywhere />
      </>
    ),
    security: <ApiKeyRow />,
    plex: <PlexSignInRow />,
    'reverse-proxy': <ReverseProxyRow />,
    about: <About />,
  }

  if (phone) {
    const open = resolve(section)
    if (open)
      return (
        <div key={open.page.id} className="flex min-h-0 flex-1 flex-col">
          <PhoneBackHeader onBack={() => onCloseSection?.()}>{open.page.title}</PhoneBackHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <PageView page={open.page} content={content} target={open.part?.id} headingHidden />
          </div>
        </div>
      )
    return (
      <div key="list" className="flex min-h-0 flex-1 flex-col">
        <SidePanel title="Settings" />
        <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-auto">
          <Entity.List>
            {pages.map((p) => (
              <Entity key={p.id} as="button" right={<ChevronRight aria-hidden className="size-4 text-gray-900" />} onClick={() => onOpenSection?.(p.id)}>
                <Entity.Content fill title={p.title} />
              </Entity>
            ))}
          </Entity.List>
        </nav>
      </div>
    )
  }

  return <DesktopSettings content={content} initial={section} />
}

function DesktopSettings({ content, initial }: { content: Record<string, ReactNode>; initial: string }) {
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
      if (id) setOpen(id)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const needle = find.trim().toLowerCase()
  const matches = pages
    .map((page) => {
      if (!needle || page.title.toLowerCase().includes(needle)) return { page, part: undefined as Part | undefined, note: undefined as string | undefined }
      // A Part's title, or one of its Rows' titles.
      for (const part of page.parts) {
        const hit = [part.title, ...part.rows].find((t) => t.toLowerCase().includes(needle))
        if (hit) return { page, part, note: hit }
      }
      return undefined
    })
    .filter((m) => m !== undefined)
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
          <Input
            size="small"
            aria-label="Find a setting"
            placeholder="Find a setting"
            type="search"
            prefix={<Search aria-hidden className="size-4" />}
            prefixStyling={false}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) {
                e.preventDefault()
                const id = matches[0].part?.id ?? matches[0].page.id
                choose(id)
                history.replaceState(history.state, '', `${location.pathname}#settings-${id}`)
              } else if (e.key === 'Escape') setFind('')
            }}
          />
        }
        views={
          <JumpNav label="Settings sections">
            {matches.length === 0 && <p className="label-13 px-2.5 py-2 text-gray-900">No setting matches “{find.trim()}”.</p>}
            {groups.map((g) => {
              const inGroup = matches.filter(({ page }) => page.group === g)
              if (inGroup.length === 0) return null
              return (
                <JumpGroup key={g} title={g}>
                  {inGroup.map(({ page, part, note }) => (
                    <JumpLink
                      key={page.id}
                      href={`${location.pathname}#settings-${part?.id ?? page.id}`}
                      current={page.id === current.page.id}
                      warn={attention.has(page.id)}
                      note={note}
                      onClick={(e) => openSectionLink(e, part?.id ?? page.id, choose)}
                    >
                      {page.title}
                    </JumpLink>
                  ))}
                </JumpGroup>
              )
            })}
          </JumpNav>
        }
      />
      <div className="min-w-0 flex-1 overflow-auto px-10 py-7">
        <div key={current.page.id} className="max-w-[880px]">
          <PageView page={current.page} content={content} target={current.part?.id} />
        </div>
      </div>
    </div>
  )
}

/** A page: its title as the heading, then each Part as an anchored group of rows. `target` is the Part to scroll to. */
function PageView({ page, content, target, headingHidden }: { page: Page; content: Record<string, ReactNode>; target?: string; headingHidden?: boolean }) {
  useScrollToPart(target, page.id)
  return (
    <section id={`settings-${page.id}`} aria-labelledby={`settings-${page.id}-title`} className="mb-8">
      <h2 id={`settings-${page.id}-title`} tabIndex={-1} className={headingHidden ? 'sr-only' : 'heading-24 mb-3'}>
        {page.title}
      </h2>
      <div className="flex flex-col gap-8">
        {page.parts.map((part) =>
          part.id === page.id ? (
            <div key={part.id} className="flex flex-col gap-4">
              {content[part.id]}
            </div>
          ) : (
            <section key={part.id} id={`settings-${part.id}`} aria-label={part.title} className="flex scroll-mt-4 flex-col gap-4">
              {content[part.id]}
            </section>
          ),
        )}
      </div>
    </section>
  )
}

function Row({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <Fieldset>
      <Fieldset.Content>
        <Fieldset.Title as="h3">{label}</Fieldset.Title>
        <Fieldset.Subtitle>{help}</Fieldset.Subtitle>
        {children}
      </Fieldset.Content>
    </Fieldset>
  )
}

function Saved({ children = 'Saved.' }: { children?: ReactNode }) {
  return (
    <Note variant="success" size="small">
      {children}
    </Note>
  )
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
    <Row label="Password" help="At least 8 characters. Changing it logs out every other session.">
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
        <fieldset disabled={declared} className="contents">
          <Input size="small" label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input size="small" label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {change.isError && (
            <Note variant="error" size="small">
              {change.error instanceof ApiError && change.error.status === 422 ? change.error.message : 'Could not change the password. Try again.'}
            </Note>
          )}
          {change.isSuccess && <Saved>Password changed. Other sessions were logged out.</Saved>}
          <Button size="small" variant="primary" typeName="submit" disabled={change.isPending || !current || !next} className="self-start">
            Change password
          </Button>
        </fieldset>
        {declared && <Note size="small">The Config File sets the account, so its password cannot be changed here. Change the file and restart Kestrel instead.</Note>}
      </form>
    </Row>
  )
}

/** Ends this browser's session; not offered to a session the proxy or the Config File opened, as the rail's button was not. */
function LogOut() {
  const auth = useAuth()
  const logout = useLogout()
  if (!(auth.data?.state === 'ok' && auth.data.me.method === 'session')) return null
  return (
    <Row label="Log out" help="Ends this session. Other sessions stay.">
      <Button size="small" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}>
        Log out
      </Button>
    </Row>
  )
}

function LogOutEverywhere() {
  const logout = useLogoutEverywhere()
  return (
    <Row label="Sessions" help="Ends every session, including this one.">
      <Button size="small" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}>
        Log out everywhere
      </Button>
    </Row>
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
    <Row label="API key" help="One full-access key for scripts and the Silo plugin, sent as the X-Api-Key header. Kestrel keeps only a hash of it.">
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
    </Row>
  )
}

function ReverseProxyRow() {
  const { data } = useReverseProxy()
  return (
    <Row
      label="Reverse proxy"
      help="Name the proxies in front of Kestrel so it sees each client's own address, for the login throttle and the Secure cookie. Header login for an SSO portal is a separate switch, off by default; the login form stays as a fallback."
    >
      {data ? <ReverseProxyForm saved={data} /> : null}
    </Row>
  )
}

function PlexSignInRow() {
  return (
    <Row
      label="Plex sign-in"
      help="Let the people you share your Plex server with sign in with their Plex account to search for Titles, make Requests and follow their own. They can reach nothing else."
    >
      <PlexSignInForm />
    </Row>
  )
}

function ReverseProxyForm({ saved }: { saved: ReverseProxy }) {
  const [enabled, setEnabled] = useState(saved.enabled)
  const [trusted, setTrusted] = useState(saved.trusted_proxies.join('\n'))
  const [header, setHeader] = useState(saved.header)
  const save = useSaveReverseProxy()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({
      enabled,
      trusted_proxies: trusted
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean),
      header: header.trim(),
    })
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <fieldset disabled={saved.from_config_file} className="contents">
        <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)}>
          Log in from the header below, from a trusted proxy (needs one)
        </Checkbox>
        <Textarea label="Trusted proxies" rows={3} value={trusted} onChange={(e) => setTrusted(e.target.value)} placeholder={'172.18.0.0/16\n10.0.0.5'} mono />
        <Input size="small" label="Header" value={header} onChange={(e) => setHeader(e.target.value)} />
        {save.isError && (
          <Note variant="error" size="small">
            {save.error instanceof ApiError && save.error.status === 422 ? save.error.message : 'Could not save. Try again.'}
          </Note>
        )}
        {save.isSuccess && <Saved />}
        <Button size="small" variant="primary" typeName="submit" disabled={save.isPending} className="self-start">
          Save reverse proxy
        </Button>
      </fieldset>
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
    </form>
  )
}
