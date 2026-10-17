import { useState, type FormEvent, type ReactNode } from 'react'
import {
  ApiError,
  useApiKey,
  useChangePassword,
  useCreateApiKey,
  useLogoutEverywhere,
  useReverseProxy,
  useSaveReverseProxy,
  type ReverseProxy,
} from '../api/queries'
import { Button, ErrorText, Field, TextInput } from '../forms'
import { DownloadClient } from '../plugins/DownloadClient'
import { Indexers } from '../plugins/Indexers'

/** Settings sections, in page order. Later tickets add theirs here. */
const sections = [
  { id: 'download-client', title: 'Download client' },
  { id: 'indexers', title: 'Indexers' },
  { id: 'account', title: 'Account' },
  { id: 'security', title: 'Security' },
]

/** One page with a jump list on the left; each section is a group of rows. */
export function Settings() {
  return (
    <div className="flex min-h-0 flex-1 overflow-auto">
      <nav aria-label="Settings sections" className="sticky top-0 w-48 shrink-0 self-start p-4">
        <ul className="flex flex-col gap-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#settings-${s.id}`} className="block rounded-md px-2 py-1 text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 max-w-3xl flex-1 p-4 pr-8">
        <Group id="download-client" title="Download client">
          <Row label="Connection" help="Where Kestrel sends NZBs and reads their progress. Test the connection to pick the categories from SABnzbd's own list.">
            <DownloadClient />
          </Row>
        </Group>
        <Group id="indexers" title="Indexers">
          <Indexers />
        </Group>
        <Group id="account" title="Account">
          <ChangePassword />
          <LogOutEverywhere />
        </Group>
        <Group id="security" title="Security">
          <ApiKeyRow />
          <ReverseProxyRow />
        </Group>
      </div>
    </div>
  )
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="mb-8">
      <h2 id={`settings-${id}-title`} className="mb-3 text-[15px] font-semibold tracking-tight">
        {title}
      </h2>
      <div className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400 bg-background-100">{children}</div>
    </section>
  )
}

function Row({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[14rem_1fr] gap-6 p-4">
      <div>
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[12px] text-gray-900">{help}</div>
      </div>
      <div>{children}</div>
    </div>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const change = useChangePassword()

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
        <Field label="Current password">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field label="New password">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        {change.isError && (
          <ErrorText>
            {change.error instanceof ApiError && change.error.status === 422 ? change.error.message : 'Could not change the password. Try again.'}
          </ErrorText>
        )}
        {change.isSuccess && <p role="status" className="text-[12px] text-green-900">Password changed. Other sessions were logged out.</p>}
        <Button type="submit" disabled={change.isPending || !current || !next} className="self-start">
          Change password
        </Button>
      </form>
    </Row>
  )
}

function LogOutEverywhere() {
  const logout = useLogoutEverywhere()
  return (
    <Row label="Sessions" help="Ends every session, including this one.">
      <Button variant="secondary" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}>
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

  const generate = () => create.mutate(undefined, { onSuccess: setShown })

  return (
    <Row label="API key" help="One full-access key for scripts and the Silo plugin, sent as the X-Api-Key header. Kestrel keeps only a hash of it.">
      <div className="flex max-w-lg flex-col gap-3">
        {shown ? (
          <div className="flex flex-col gap-2 rounded-md border border-gray-alpha-400 bg-background-200 p-3">
            <p className="text-[12px] text-gray-900">This is the only time the key is shown. Copy it now.</p>
            <code className="break-all font-mono text-[13px]">{shown}</code>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(shown)}>
                Copy
              </Button>
              <Button onClick={() => setShown(null)}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            {info.data && (
              <p className="text-[13px]">
                {exists ? (
                  <>
                    <code className="font-mono">{info.data.prefix}…</code>, created {new Date(info.data.created_at ?? '').toLocaleDateString()}
                  </>
                ) : (
                  <span className="text-gray-900">No API key yet.</span>
                )}
              </p>
            )}
            {create.isError && <ErrorText>Could not generate a key. Try again.</ErrorText>}
            <Button variant={exists ? 'secondary' : 'primary'} disabled={create.isPending || !info.data} onClick={generate} className="self-start">
              {exists ? 'Rotate API key' : 'Generate API key'}
            </Button>
            {exists && <p className="text-[12px] text-gray-900">Rotating stops the old key at once.</p>}
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
      help="Let an SSO portal in front of Kestrel log the admin in with a header. Off by default; the login form stays as a fallback."
    >
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
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Trust a login header from a reverse proxy
      </label>
      <Field label="Trusted proxies">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            value={trusted}
            onChange={(e) => setTrusted(e.target.value)}
            placeholder={'172.18.0.0/16\n10.0.0.5'}
            className="w-full rounded-md border border-gray-alpha-400 bg-background-100 px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-gray-700"
          />
        )}
      </Field>
      <Field label="Header">{(id) => <TextInput id={id} value={header} onChange={(e) => setHeader(e.target.value)} />}</Field>
      {save.isError && <ErrorText>{save.error instanceof ApiError && save.error.status === 422 ? save.error.message : 'Could not save. Try again.'}</ErrorText>}
      {save.isSuccess && (
        <p role="status" className="text-[12px] text-green-900">
          Saved.
        </p>
      )}
      <Button type="submit" disabled={save.isPending} className="self-start">
        Save reverse proxy
      </Button>
      {saved.untrusted.length > 0 && (
        <section aria-label="Untrusted proxy header sightings" className="rounded-md border border-gray-alpha-400 bg-background-200 p-3 text-[12px]">
          <p className="mb-1 font-medium">The header came from addresses that are not trusted proxies, so it was ignored:</p>
          <ul className="flex flex-col gap-0.5">
            {saved.untrusted.map((u) => (
              <li key={u.ip} className="font-mono">
                {u.ip} sent “{u.value}” {u.count} time{u.count === 1 ? '' : 's'}, last {new Date(u.last_seen).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  )
}
