import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, useChangePassword, useLogoutEverywhere } from '../api/queries'
import { Button, ErrorText, Field, TextInput } from '../forms'
import { DownloadClient } from '../plugins/DownloadClient'

/** Settings sections, in page order. Later tickets add theirs here. */
const sections = [
  { id: 'download-client', title: 'Download client' },
  { id: 'account', title: 'Account' },
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
        <Group id="account" title="Account">
          <ChangePassword />
          <LogOutEverywhere />
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
