// chrome: pending
import { Badge, Button, Fieldset, Input, Note } from '@hyprsh/design'
import { Check } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, useCompleteSetup, useCreateAccount, usePluginInstances, usePlugins, useProfiles, useSetup, useSettings } from '../api/queries'
import { Adoption } from '../adoption/Adoption'
import { DownloadClient } from '../plugins/DownloadClient'
import { Indexer } from '../plugins/Indexer'
import { LanguageForm } from '../profiles/Language'
import { DefaultsPerSlot } from '../profiles/Profiles'
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
    create.error instanceof ApiError && create.error.code === 'conflict' ? 'An account already exists. Reload to log in.' : create.isError ? 'Could not create the account. Try again.' : null

  return (
    <div className="flex min-h-full justify-center overflow-auto bg-background-200 p-8 copy-13 text-gray-1000">
      <div className="w-full max-w-2xl">
        <div className="heading-24 mb-6 flex items-center gap-2">
          <KestrelLogo className="size-6" /> Set up Kestrel
        </div>
        <Section
          n={1}
          id="account"
          title="Account"
          checked={signedIn}
          description={signedIn ? 'The admin account exists and you are logged in.' : 'Create the admin login. Kestrel is never open without one.'}
        >
          {!signedIn && (
            <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
              <Input size="small" label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
              <Input size="small" label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Input size="small" label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {(problem ?? serverProblem) && (
                <Note variant="error" size="small">
                  {problem ?? serverProblem}
                </Note>
              )}
              <Button size="small" variant="primary" typeName="submit" disabled={create.isPending} className="self-start">
                Create account
              </Button>
            </form>
          )}
        </Section>
        {signedIn && setup.data && (
          <>
            <Section
              n={2}
              id="language"
              title="Primary Language"
              state={sections.language}
              summary={<LanguageSummary />}
              description="Choose the language your household watches in. You can change it later in Settings."
            >
              <LanguageForm />
            </Section>
            <Section
              n={3}
              id="download-client"
              title="Download client"
              state={sections.download_client}
              summary={<InstanceSummary contract="download_client.v1" />}
              description="Connect SABnzbd. Kestrel hands it NZBs and reads its queue and history."
            >
              <DownloadClient />
            </Section>
            <Section
              n={4}
              id="indexer"
              title="Indexer"
              state={sections.indexer}
              summary={<InstanceSummary contract="indexer.v1" />}
              description="Add a Newznab indexer. Kestrel searches it for releases and fetches their NZBs. You can add more in Settings."
            >
              <Indexer />
            </Section>
            <Section
              n={5}
              id="root-folders"
              title="Root folders"
              state={sections.root_folders}
              summary={<RootFoldersSummary />}
              description="Choose where Kestrel puts Movies and Series. The paths are prefilled for the standard /data layout."
            >
              <RootFoldersForm />
            </Section>
            <Section
              n={6}
              id="profiles"
              title="Profiles"
              state={sections.profiles}
              summary={<ProfilesSummary />}
              description="Pick the Profile each new Title gets per Slot. Standard is preselected; leave 4K empty to add it per Title."
            >
              <DefaultsPerSlot />
            </Section>
            <Section n={7} id="adopt" title="Adopt existing library (optional)">
              <Adoption embedded />
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
        <Note variant="error" size="small">
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
        </Note>
      )}
      <div className="flex gap-2">
        <Button size="small" variant="primary" disabled={finish.isPending} onClick={() => finish.mutate(undefined, { onSuccess: onLeave })}>
          Finish setup
        </Button>
        {completed && (
          <Button size="small" onClick={onLeave}>
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
  return (
    <>
      {name}, release dates and ratings for {l.release_date_country}
    </>
  )
}

function InstanceSummary({ contract }: { contract: string }) {
  const { data: instances } = usePluginInstances()
  const { data: plugins } = usePlugins()
  const names = (instances ?? []).filter((i) => i.enabled && plugins?.find((p) => p.id === i.plugin_id)?.contract === contract).map((i) => i.name)
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
  const { data: profiles } = useProfiles()
  if (!profiles) return null
  const names = (kind: 'default_movies' | 'default_series') =>
    profiles
      .filter((p) => p[kind])
      .map((p) => p.name)
      .join(', ')
  return (
    <>
      Movies: {names('default_movies')}; Series: {names('default_series')}
    </>
  )
}

/**
 * A numbered wizard section. A finished one folds to a one-line summary with an
 * Edit button; a section without a state (Account, the optional Adopt step) is
 * always open.
 */
function Section({
  n,
  id,
  title,
  description,
  state,
  checked,
  summary,
  children,
}: {
  n: number
  id: string
  title: string
  description?: string
  state?: 'done' | 'todo'
  /** Shows the check mark without folding, for a step that has no form once done. */
  checked?: boolean
  summary?: ReactNode
  children: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const folded = state === 'done' && !editing
  const done = state === 'done' || checked
  return (
    <section aria-labelledby={`wizard-${id}`} className="mt-4 first:mt-0">
      <Fieldset>
        <Fieldset.Content>
          <div className="flex items-center justify-between gap-4">
            <Fieldset.Title as="h2" id={`wizard-${id}`}>
              <span className="flex items-center gap-2">
                <span aria-hidden>
                  <Badge size="sm" variant={done ? 'green-subtle' : 'gray-subtle'}>
                    {done ? <Check className="size-3" /> : n}
                  </Badge>
                </span>
                {title}
              </span>
            </Fieldset.Title>
            {folded && (
              <Button size="small" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
          {folded ? (
            <Fieldset.Subtitle>{summary}</Fieldset.Subtitle>
          ) : (
            <>
              {description && <Fieldset.Subtitle>{description}</Fieldset.Subtitle>}
              {children}
            </>
          )}
        </Fieldset.Content>
      </Fieldset>
    </section>
  )
}
