import { Check } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  ApiError,
  useCompleteSetup,
  useCreateAccount,
  usePluginInstances,
  usePlugins,
  useProfiles,
  useSetup,
  useSettings,
} from '../api/queries'
import { Button, ErrorText, Field, TextInput } from '../forms'
import { DownloadClient } from '../plugins/DownloadClient'
import { Indexer } from '../plugins/Indexer'
import { LanguageForm } from '../profiles/Language'
import { DefaultsPerSlot, KidsRuleForm } from '../profiles/Profiles'
import { RootFoldersForm } from '../rootfolders/RootFolders'
import { KestrelLogo } from '../ui'

const MIN_PASSWORD = 8

/**
 * The setup wizard. A fresh instance lands here for every page. Account comes
 * first; whoever reaches the instance sets the credentials, and finishing the
 * step logs them in. The other sections arrive with later tickets.
 */
export function Wizard({ signedIn, onLeave }: { signedIn: boolean; onLeave: () => void }) {
  const setup = useSetup(signedIn)
  const sections = setup.data?.sections ?? { language: 'todo', download_client: 'todo', indexer: 'todo', root_folders: 'todo', profiles: 'todo' }
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const create = useCreateAccount()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return setProblem('Choose a username')
    if (password.length < MIN_PASSWORD) return setProblem(`Use at least ${MIN_PASSWORD} characters for the password`)
    if (password !== confirm) return setProblem('The passwords do not match')
    setProblem(null)
    create.mutate({ username: username.trim(), password })
  }

  const serverProblem =
    create.error instanceof ApiError && create.error.code === 'conflict'
      ? 'An account already exists. Reload to log in.'
      : create.isError
        ? 'Could not create the account. Try again.'
        : null

  return (
    <div className="flex min-h-full justify-center overflow-auto bg-background-200 p-8 text-[13px] text-gray-1000">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <KestrelLogo className="size-6" /> Set up Kestrel
        </div>
        <section aria-labelledby="wizard-account" className="rounded-lg border border-gray-alpha-400 bg-background-100 p-6">
          <h2 id="wizard-account" className="mb-1 flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="flex size-5 items-center justify-center rounded-full bg-gray-1000 text-[11px] text-background-100">
              {signedIn ? <Check className="size-3" /> : 1}
            </span>
            Account
          </h2>
          <p className="mb-4 text-gray-900">
            {signedIn ? 'The admin account exists and you are logged in.' : 'Create the admin login. Kestrel is never open without one.'}
          </p>
          {!signedIn && <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
            <Field label="Username">{(id) => <TextInput id={id} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />}</Field>
            <Field label="Password">
              {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Field label="Confirm password">
              {(id) => <TextInput id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
            </Field>
            {(problem ?? serverProblem) && <ErrorText>{problem ?? serverProblem}</ErrorText>}
            <Button type="submit" disabled={create.isPending} className="self-start">
              Create account
            </Button>
          </form>}
        </section>
        {signedIn && setup.data && (
          <>
            <Section n={2} id="language" title="Primary Language" state={sections.language} summary={<LanguageSummary />}>
              <p className="mb-4 text-gray-900">Choose the language your household watches in. You can change it later in Settings.</p>
              <LanguageForm />
            </Section>
            <Section n={3} id="download-client" title="Download client" state={sections.download_client} summary={<InstanceSummary contract="download_client.v1" />}>
              <p className="mb-4 text-gray-900">Connect SABnzbd. Kestrel hands it NZBs and reads its queue and history.</p>
              <DownloadClient />
            </Section>
            <Section n={4} id="indexer" title="Indexer" state={sections.indexer} summary={<InstanceSummary contract="indexer.v1" />}>
              <p className="mb-4 text-gray-900">Add a Newznab indexer. Kestrel searches it for releases and fetches their NZBs. You can add more in Settings.</p>
              <Indexer />
            </Section>
            <Section n={5} id="root-folders" title="Root folders" state={sections.root_folders} summary={<RootFoldersSummary />}>
              <p className="mb-4 text-gray-900">Choose where Kestrel puts Movies and Series. The paths are prefilled for the standard /data layout.</p>
              <RootFoldersForm />
            </Section>
            <Section n={6} id="profiles" title="Profiles" state={sections.profiles} summary={<ProfilesSummary />}>
              <p className="mb-4 text-gray-900">Pick the Profile each new Title gets per Slot. HD is preselected; leave SD and UHD empty to add them per Title.</p>
              <DefaultsPerSlot />
              <h3 className="mb-2 mt-6 text-[13px] font-semibold">Kids rule</h3>
              <KidsRuleForm />
            </Section>
            <Section n={7} id="adopt" title="Adopt existing library (optional)">
              <p className="text-gray-900">
                Already have a library on disk? Kestrel will be able to adopt it without moving or renaming anything. This step arrives with Series Adoption; skip it for now.
              </p>
            </Section>
            <Finish completed={setup.data.completed} onLeave={onLeave} />
          </>
        )}
      </div>
    </div>
  )
}

const sectionTitles: Record<string, string> = {
  account: 'Account',
  language: 'Primary Language',
  download_client: 'Download client',
  indexer: 'Indexer',
  root_folders: 'Root folders',
  profiles: 'Profiles',
}

/** "Finish setup" names whatever is still missing instead of letting the admin through. */
function Finish({ completed, onLeave }: { completed: boolean; onLeave: () => void }) {
  const finish = useCompleteSetup()
  const missing = finish.error instanceof ApiError ? finish.error.fields.filter((f) => f.field.startsWith('sections.')) : []
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-gray-alpha-400 pt-4">
      {finish.isError && (
        <div role="alert" className="text-[12px] text-red-900">
          {missing.length > 0 ? (
            <>
              <p className="mb-1 font-medium">Finish these sections first:</p>
              <ul className="list-disc pl-5">
                {missing.map((f) => (
                  <li key={f.field}>{sectionTitles[f.field.slice('sections.'.length)] ?? f.field}</li>
                ))}
              </ul>
            </>
          ) : (
            'Could not finish setup. Try again.'
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={finish.isPending} onClick={() => finish.mutate(undefined, { onSuccess: onLeave })}>
          Finish setup
        </Button>
        {completed && (
          <Button variant="secondary" onClick={onLeave}>
            Back to Kestrel
          </Button>
        )}
      </div>
    </div>
  )
}

function LanguageSummary() {
  const { data } = useSettings()
  if (!data) return null
  const l = data.language_region
  const name = { en: 'English', de: 'German', fr: 'French' }[l.primary_language]
  return <>{name}, release dates and ratings for {l.release_date_country}</>
}

function InstanceSummary({ contract }: { contract: string }) {
  const { data: instances } = usePluginInstances()
  const { data: plugins } = usePlugins()
  const names = (instances ?? [])
    .filter((i) => i.enabled && plugins?.find((p) => p.id === i.plugin_id)?.contract === contract)
    .map((i) => i.name)
  return <>{names.join(', ')}</>
}

function RootFoldersSummary() {
  const { data } = useSettings()
  if (!data) return null
  const { movies, series } = data.root_folders
  return (
    <>
      Movies in {movies.join(', ')}; Series in {series.join(', ')}
    </>
  )
}

function ProfilesSummary() {
  const { data: settings } = useSettings()
  const { data: profiles } = useProfiles()
  if (!settings || !profiles) return null
  const names = (kind: 'default_movies' | 'default_series') =>
    profiles
      .filter((p) => p[kind])
      .map((p) => p.name)
      .join(', ')
  const kids = settings.kids_rule
  return (
    <>
      Movies: {names('default_movies')}; Series: {names('default_series')}. Kids rule {kids.enabled ? `on, age ${kids.threshold} or younger` : 'off'}
    </>
  )
}

/**
 * A numbered wizard section after Account. A finished one folds to a one-line
 * summary with an Edit button; a section without a state (the optional Adopt
 * step) is always open.
 */
function Section({
  n,
  id,
  title,
  state,
  summary,
  children,
}: {
  n: number
  id: string
  title: string
  state?: 'done' | 'todo'
  summary?: ReactNode
  children: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const folded = state === 'done' && !editing
  return (
    <section aria-labelledby={`wizard-${id}`} className="mt-4 rounded-lg border border-gray-alpha-400 bg-background-100 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 id={`wizard-${id}`} className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-gray-1000 text-[11px] text-background-100">
            {state === 'done' ? <Check className="size-3" /> : n}
          </span>
          {title}
        </h2>
        {folded && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
      {folded ? <p className="mt-1 text-gray-900">{summary}</p> : <div className="mt-1">{children}</div>}
    </section>
  )
}
