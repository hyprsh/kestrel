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
import { ApiError, useApiKey, useAuth, useChangePassword, useCreateApiKey, useLogoutEverywhere, useReverseProxy, useSaveReverseProxy, type ReverseProxy } from '../api/queries'
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

/** Settings sections, in page order (the phone's list), each in the group the desktop panel files it under. */
const sections = [
  { id: 'language', title: 'Primary Language', group: 'Media', rows: ['Language and country'] },
  { id: 'display', title: 'Display', group: 'Media', rows: ['Household defaults'] },
  { id: 'profiles', title: 'Profiles', group: 'Media', rows: ['Defaults per Slot', 'Profiles'] },
  { id: 'trash', title: 'TRaSH', group: 'Media', rows: ['Custom Formats and profiles'] },
  { id: 'metadata', title: 'Provider keys', group: 'Connections', rows: ['TMDB and TheTVDB'] },
  { id: 'download-client', title: 'Download client', group: 'Connections', rows: [] },
  { id: 'indexers', title: 'Indexers', group: 'Connections', rows: [] },
  { id: 'grabs', title: 'Grabs', group: 'Connections', rows: ['Automatic Grabs'] },
  { id: 'root-folders', title: 'Root folders', group: 'Media', rows: ['Folders'] },
  { id: 'adoption', title: 'Existing files', group: 'Media', rows: ['Adopt existing library'] },
  { id: 'media-servers', title: 'Media servers', group: 'Connections', rows: [] },
  { id: 'plex', title: 'Plex', group: 'Connections', rows: ['Plex sign-in'] },
  { id: 'silo', title: 'Silo', group: 'Connections', rows: ['Watch-ahead'] },
  { id: 'account', title: 'Account', group: 'System', rows: ['Password', 'Sessions'] },
  { id: 'updates', title: 'Updates', group: 'System', rows: ['GitHub'] },
  { id: 'security', title: 'Security', group: 'System', rows: ['API key'] },
  { id: 'reverse-proxy', title: 'Reverse proxy', group: 'System', rows: ['Reverse proxy', 'Trusted proxies'] },
  { id: 'setup', title: 'Setup', group: 'System', rows: ['Setup wizard'] },
]
const groups = ['Media', 'Connections', 'System']

/** The sections whose Health check fails or warns: the download client, an indexer, a low disk (the Root folders). */
function useAttentionSections(): Set<string> {
  const status = useStatus()
  const out = new Set<string>()
  if (!status.data) return out
  for (const t of healthOf(status.data).groups.flatMap((g) => g.tiles)) {
    if (t.tone === 'failing' && t.key === 'client') out.add('download-client')
    else if (t.tone === 'failing' && t.key.startsWith('indexer-')) out.add('indexers')
    else if (t.tone === 'low') out.add('root-folders')
  }
  return out
}

/** The section a "#settings-<id>" address names, if there is one. */
const hashSection = () => sections.find((s) => location.hash === `#settings-${s.id}`)?.id

/** Opens a section: its heading takes focus and the address keeps the page, rather than the base URL's Overview. */
function openSectionLink(event: MouseEvent<HTMLAnchorElement>, id: string, open: (id: string) => void) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  open(id)
  history.replaceState(history.state, '', event.currentTarget.href)
  // The section renders on the next paint.
  setTimeout(() => document.getElementById(`settings-${id}-title`)?.focus(), 0)
}

/**
 * A panel of sections on the left and the open section, a group of rows, beside it (the first until one is chosen). On a phone the list is a
 * screen of its own and a section another, full screen with a Back button: `section` is the open
 * one ("" is the list), kept by the Shell in the address bar so the browser's Back returns to the list.
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
      <>
        <Row label="Language and country" help="The household's language and the country whose release dates and age ratings Kestrel reads.">
          <LanguageForm />
        </Row>
      </>
    ),
    display: (
      <>
        <Row label="Household defaults" help="How every browser starts: the order of a Series' seasons, which seasons are open, and where Manual search and Upcoming begin.">
          <DisplayForm />
        </Row>
      </>
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
      <>
        <Row label="Custom Formats and profiles" help="Kestrel scores Releases with TRaSH's Custom Formats. It checks daily and takes the newest set whole, after re-scoring every file under it.">
          <TrashForm />
        </Row>
      </>
    ),
    metadata: (
      <>
        <Row label="TMDB and TheTVDB" help="Kestrel looks Titles up with the project's own keys. Enter your own to use them instead; they are never shown again.">
          <ProviderKeysForm />
        </Row>
      </>
    ),
    'download-client': (
      <>
        <DownloadClientRow />
      </>
    ),
    indexers: (
      <>
        <Indexers />
      </>
    ),
    grabs: (
      <>
        <Row label="Automatic Grabs" help="Hold Kestrel back, for example after a large Adoption, without disabling the download client or the indexers.">
          <PauseGrabsSwitch />
        </Row>
      </>
    ),
    'root-folders': (
      <>
        <Row label="Folders" help="Where Imports put Movies and Series. The first of each kind is the default when adding a Title.">
          <RootFoldersForm compact />
        </Row>
      </>
    ),
    adoption: (
      <>
        <Row label="Adopt existing library" help="Scan the Movie and Series Root folders for files Kestrel does not manage yet and take them over without downloading again.">
          <Button size="small" onClick={onAdopt}>
            {adoptionLabel(adoption.data?.state)}
          </Button>
        </Row>
      </>
    ),
    'media-servers': (
      <>
        <MediaServers />
      </>
    ),
    plex: (
      <>
        <PlexSignInRow />
      </>
    ),
    silo: (
      <>
        <Row
          label="Watch-ahead"
          help="Series requested whole in Silo start with season 1, and Kestrel adds the next season once 2 episodes of the newest one have been watched in Plex or Silo. The Kestrel plugin in Silo can override this per request route."
        >
          <SiloSettingsForm />
        </Row>
      </>
    ),
    account: (
      <>
        <ChangePassword />
        <LogOutEverywhere />
      </>
    ),
    updates: (
      <>
        <Row label="GitHub" help="One switch for the daily release, security advisory and TRaSH checks.">
          <UpdateCheckSwitch />
        </Row>
      </>
    ),
    security: (
      <>
        <ApiKeyRow />
      </>
    ),
    'reverse-proxy': (
      <>
        <ReverseProxyRow />
      </>
    ),
    setup: (
      <>
        <Row label="Setup wizard" help="Walk through the setup sections again. The account stays as it is.">
          <Button size="small" onClick={onRunSetup}>
            Run setup again
          </Button>
        </Row>
      </>
    ),
  }

  if (phone) {
    const open = sections.find((s) => s.id === section)
    if (open)
      return (
        <div key={open.id} className="flex min-h-0 flex-1 flex-col">
          <PhoneBackHeader onBack={() => onCloseSection?.()}>{open.title}</PhoneBackHeader>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <Group id={open.id} title={open.title} headingHidden>
              {content[open.id]}
            </Group>
          </div>
        </div>
      )
    return (
      <div key="list" className="flex min-h-0 flex-1 flex-col">
        <SidePanel title="Settings" />
        <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-auto">
          <Entity.List>
            {sections.map((s) => (
              <Entity key={s.id} as="button" right={<ChevronRight aria-hidden className="size-4 text-gray-900" />} onClick={() => onOpenSection?.(s.id)}>
                <Entity.Content fill title={s.title} />
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
  const known = (id: string | undefined) => sections.find((s) => s.id === id)?.id
  const [open, setOpen] = useState(known(initial) ?? hashSection() ?? sections[0].id)
  const [find, setFind] = useState('')
  const attention = useAttentionSections()
  // A place opened from elsewhere ("/settings/indexers"), or the address changing under us.
  useEffect(() => {
    const id = known(initial)
    if (id) setOpen(id)
  }, [initial])
  useEffect(() => {
    const onHash = () => {
      const id = hashSection()
      if (id) setOpen(id)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const needle = find.trim().toLowerCase()
  const matches = sections
    .map((s) => ({ s, row: s.title.toLowerCase().includes(needle) ? undefined : s.rows.find((r) => r.toLowerCase().includes(needle)) }))
    .filter(({ s, row }) => !needle || s.title.toLowerCase().includes(needle) || row !== undefined)
  const choose = (id: string) => {
    setOpen(id)
    setFind('')
  }
  const current = sections.find((s) => s.id === open)!

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
                choose(matches[0].s.id)
                history.replaceState(history.state, '', `${location.pathname}#settings-${matches[0].s.id}`)
              } else if (e.key === 'Escape') setFind('')
            }}
          />
        }
      >
        <JumpNav label="Settings sections">
          {matches.length === 0 && <p className="label-13 px-2.5 py-2 text-gray-900">No setting matches “{find.trim()}”.</p>}
          {groups.map((g) => {
            const inGroup = matches.filter(({ s }) => s.group === g)
            if (inGroup.length === 0) return null
            return (
              <JumpGroup key={g} title={g}>
                {inGroup.map(({ s, row }) => (
                  <JumpLink key={s.id} href={`${location.pathname}#settings-${s.id}`} current={s.id === open} warn={attention.has(s.id)} note={row} onClick={(e) => openSectionLink(e, s.id, choose)}>
                    {s.title}
                  </JumpLink>
                ))}
              </JumpGroup>
            )
          })}
        </JumpNav>
      </SidePanel>
      <div className="min-w-0 flex-1 overflow-auto px-10 py-7">
        <div key={current.id} className="max-w-[880px]">
          <Group id={current.id} title={current.title}>
            {content[current.id]}
          </Group>
        </div>
      </div>
    </div>
  )
}

function Group({ id, title, headingHidden, children }: { id: string; title: string; headingHidden?: boolean; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="mb-8">
      <h2 id={`settings-${id}-title`} tabIndex={-1} className={headingHidden ? 'sr-only' : 'heading-24 mb-3'}>
        {title}
      </h2>
      <div className="flex flex-col gap-4">{children}</div>
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
