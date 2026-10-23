import { Button, Checkbox, Fieldset, Input, Note, Textarea } from '@hyprsh/design'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { usePhone } from '../responsive'
import { ApiError, useApiKey, useAuth, useChangePassword, useCreateApiKey, useLogoutEverywhere, useReverseProxy, useSaveReverseProxy, type ReverseProxy } from '../api/queries'
import { UpdateCheckSwitch } from '../about/UpdateCheck'
import { PauseGrabsSwitch } from '../grabs/PauseGrabs'
import { DownloadClientRow } from '../plugins/DownloadClient'
import { Indexers } from '../plugins/Indexers'
import { MediaServers } from '../plugins/MediaServers'
import { ProviderKeysForm } from '../metadata/ProviderKeys'
import { TrashForm } from '../trash/Trash'
import { LanguageForm } from '../profiles/Language'
import { RootFoldersForm } from '../rootfolders/RootFolders'
import { DefaultsPerSlot, ProfileToggles } from '../profiles/Profiles'

/** Settings sections, in page order. Later tickets add theirs here. */
const sections = [
  { id: 'language', title: 'Primary Language' },
  { id: 'profiles', title: 'Profiles' },
  { id: 'trash', title: 'TRaSH' },
  { id: 'metadata', title: 'Provider keys' },
  { id: 'download-client', title: 'Download client' },
  { id: 'indexers', title: 'Indexers' },
  { id: 'grabs', title: 'Grabs' },
  { id: 'root-folders', title: 'Root folders' },
  { id: 'adoption', title: 'Existing files' },
  { id: 'media-servers', title: 'Media servers' },
  { id: 'account', title: 'Account' },
  { id: 'updates', title: 'Updates' },
  { id: 'security', title: 'Security' },
  { id: 'setup', title: 'Setup' },
]

/** Scrolls to a section and focuses its heading, keeping the page (and its place) rather than the base URL's Overview. */
function jumpTo(event: MouseEvent<HTMLAnchorElement>, id: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  document.getElementById(`settings-${id}`)?.scrollIntoView()
  document.getElementById(`settings-${id}-title`)?.focus()
  history.replaceState(history.state, '', event.currentTarget.href)
}

/**
 * One page with a jump list on the left; each section is a group of rows. On a phone the list is a
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
  const content: Record<string, ReactNode> = {
    language: (
      <>
        <Row label="Language and country" help="The household's language and the country whose release dates and age ratings Kestrel reads.">
          <LanguageForm />
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
            Scan for unmanaged files
          </Button>
        </Row>
      </>
    ),
    'media-servers': (
      <>
        <MediaServers />
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
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-alpha-400 py-1 pr-3 pl-1">
            <Button variant="tertiary" prefix={<ArrowLeft />} onClick={onCloseSection}>
              Back
            </Button>
            <span className="label-14 min-w-0 flex-1 truncate">{open.title}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <Group id={open.id} title={open.title} headingHidden>
              {content[open.id]}
            </Group>
          </div>
        </div>
      )
    return (
      <nav key="list" aria-label="Settings sections" className="min-h-0 flex-1 overflow-auto">
        <ul className="divide-y divide-gray-alpha-400">
          {sections.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpenSection?.(s.id)} className="label-14 flex min-h-12 w-full touch-manipulation items-center justify-between gap-2 px-4 text-left">
                {s.title}
                <ChevronRight aria-hidden className="size-4 shrink-0 text-gray-900" />
              </button>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      <nav aria-label="Settings sections" className="sticky top-0 w-48 shrink-0 self-start p-4">
        <ul className="flex flex-col gap-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`${location.pathname}#settings-${s.id}`} onClick={(e) => jumpTo(e, s.id)} className="label-14 block rounded-md px-2 py-1 text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 max-w-3xl flex-1 p-4 pr-8">
        {sections.map((s) => (
          <Group key={s.id} id={s.id} title={s.title}>
            {content[s.id]}
          </Group>
        ))}
      </div>
    </div>
  )
}

function Group({ id, title, headingHidden, children }: { id: string; title: string; headingHidden?: boolean; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="mb-8">
      <h2 id={`settings-${id}-title`} tabIndex={-1} className={headingHidden ? 'sr-only' : 'heading-20 mb-3'}>
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
          <div className="flex flex-col gap-2 rounded-md border border-gray-alpha-400 bg-background-200 p-3">
            <p className="copy-13 text-gray-900">This is the only time the key is shown. Copy it now.</p>
            <code className="copy-13-mono break-all">{shown}</code>
            <div className="flex gap-2">
              <Button size="small" onClick={() => void navigator.clipboard?.writeText(shown)}>
                Copy
              </Button>
              <Button size="small" variant="primary" onClick={() => setShown(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            {info.data && (
              <p className="copy-13">
                {exists ? (
                  <>
                    <code className="copy-13-mono">{info.data.prefix}…</code>, {fromEnv ? 'set from the environment' : `created ${new Date(info.data.created_at ?? '').toLocaleDateString()}`}
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
                The <code className="copy-13-mono">KESTREL_API_KEY</code> environment variable sets this key, so it cannot be rotated here. Change the variable and restart Kestrel instead.
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
    <Row label="Reverse proxy" help="Name the proxies in front of Kestrel so it sees each client's own address, for the login throttle and the Secure cookie. Header login for an SSO portal is a separate switch, off by default; the login form stays as a fallback.">
      {data ? <ReverseProxyForm saved={data} /> : null}
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
