import { Badge, Button, Fieldset, Input, Link, Note, Separator } from '@hyprsh/design'
import { Check } from 'lucide-react'
import { useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { ApiError, useCompleteSetup, useCreateAccount, usePluginInstances, usePlugins, useProfiles, useSetup, useSettings } from '../api/queries'
import { useSlots } from '../api/slots'
import { Adoption } from '../adoption/Adoption'
import { WidePage } from '../layout/WidePage'
import { DownloadClient } from '../plugins/DownloadClient'
import { Indexer } from '../plugins/Indexer'
import { EnableProfiles } from '../profiles/EnableProfiles'
import { LanguageForm } from '../profiles/Language'
import { PrimaryDraft } from '../profiles/recipe'
import { RootFoldersForm } from '../rootfolders/RootFolders'
import { SlotPresets } from '../slots/SlotPresets'
import { SlotsSection } from '../slots/SlotsSection'
import { showPlace } from '../place'
import { KestrelLogo } from '../ui'

const MIN_PASSWORD = 8

/**
 * The setup wizard. A fresh instance lands here for every page. Account comes
 * first; whoever reaches the instance sets the credentials, and finishing the
 * step logs them in. The other sections arrive with later tickets.
 */
export function Wizard({ signedIn, onLeave }: { signedIn: boolean; onLeave: () => void }) {
  const setup = useSetup(signedIn)
  const sections = setup.data?.sections ?? { language: 'todo', download_client: 'todo', indexer: 'todo', root_folders: 'todo', slots: 'todo' }
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const create = useCreateAccount()
  const [draft, setDraft] = useState<string>()
  const primaryDraft = useMemo(() => ({ draft, setDraft }), [draft])

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
    <PrimaryDraft.Provider value={primaryDraft}>
      <WidePage>
        <div className="heading-24 mb-6 flex items-center gap-2">
          <KestrelLogo className="size-6" /> Set up Kestrel
        </div>
        <Section
          n={1}
          id="account"
          title="Account"
          need="required"
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
                Create Account
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
              need="required"
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
              need="required"
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
              need="required"
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
              need="required"
              state={sections.root_folders}
              summary={<RootFoldersSummary />}
              description="Choose where Kestrel puts Movies and Series. The paths are prefilled for the standard /data layout."
            >
              <RootFoldersForm />
            </Section>
            <Section
              n={6}
              id="slots"
              title="Slots"
              need="required"
              state={sections.slots}
              summary={<SlotsSummary />}
              description="A Slot is a named place in every Title that holds at most one Version, such as Standard or 4K. Each has a default Profile for a new Movie and a new Series. Start from a preset, then adjust the Slots."
            >
              <div className="flex flex-col gap-4">
                <SlotPresets />
                <SlotsSection embedded />
              </div>
            </Section>
            <Section
              n={7}
              id="profiles"
              title="Profiles"
              need="optional"
              checked={sections.slots === 'done'}
              description="Choose which Profiles to enable. The ones your Slots use are on and stay on, so you can skip this and add more later. Tick a Profile to enable it, or a suggestion to add it."
            >
              <div className="flex flex-col gap-3">
                <EnableProfiles />
                <p className="copy-13 text-gray-900">
                  Every Profile also has a <strong>Cutoff</strong> (&ldquo;Good enough at&rdquo;): Kestrel stops upgrading a file once it reaches that quality and the Score you set, and a Profile with
                  no Cutoff never stops. It has size limits too, the smallest and largest a Release may be per episode and per Movie. Neither needs setting now. Open a Profile in Settings &rsaquo;
                  Slots &amp; Profiles after setup to set them.
                </p>
              </div>
            </Section>
            <Section n={8} id="adopt" title="Adopt existing library" need="optional">
              <Adoption embedded />
            </Section>
            <Summary n={9} sections={sections} completed={setup.data.completed} onLeave={onLeave} />
          </>
        )}
      </WidePage>
    </PrimaryDraft.Provider>
  )
}

const sectionTitles: Record<string, string> = {
  account: 'Account',
  language: 'Primary Language',
  download_client: 'Download client',
  indexer: 'Indexer',
  root_folders: 'Root folders',
  slots: 'Slots',
}

/** The address of a place under the base URL, for a link's href. */
const hrefOf = (path: string) => new URL(path.replace(/^\//, ''), document.baseURI).pathname

/**
 * The last step: what is set up, where to go next and "Finish setup", which names whatever is still missing instead of letting
 * the admin through. The links finish setup first and then open their place, so they work like the button. Media servers are
 * not a step: Kestrel works without them, and they are connected in Settings.
 */
function Summary({ n, sections, completed, onLeave }: { n: number; sections: Record<string, 'done' | 'todo'>; completed: boolean; onLeave: () => void }) {
  const finish = useCompleteSetup()
  const missing = finish.error instanceof ApiError ? finish.error.fields.filter((f) => f.field.startsWith('sections.')) : []
  // The place goes into the address bar first: the Shell reads it when it replaces the wizard. A refusal puts the address back.
  const finishTo = (path: string) => {
    const before = location.href
    showPlace(path)
    finish.mutate(undefined, { onSuccess: onLeave, onError: () => history.replaceState(history.state, '', before) })
  }
  const link = (path: string) => ({
    href: hrefOf(path),
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || finish.isPending) return
      e.preventDefault()
      finishTo(path)
    },
  })
  return (
    <section aria-labelledby="wizard-summary" className="mt-4">
      <Fieldset>
        <Fieldset.Content>
          <div className="flex flex-wrap items-center gap-2">
            <Fieldset.Title as="h2" id="wizard-summary">
              <span className="flex items-center gap-2">
                <span aria-hidden>
                  <Badge size="sm" contrast="low" variant={completed ? 'green' : 'gray'}>
                    {completed ? <Check className="size-3" /> : n}
                  </Badge>
                </span>
                Summary
              </span>
            </Fieldset.Title>
            <Need need="required" />
          </div>
          <Fieldset.Subtitle>Finish setup to open Kestrel. If a required step was missed, Finish names it.</Fieldset.Subtitle>
          <ul className="copy-14 flex flex-col gap-1">
            {Object.entries(sectionTitles).map(([key, title]) => (
              <li key={key}>
                {title}: {key === 'account' || sections[key] === 'done' ? 'done' : 'still to do'}
              </li>
            ))}
          </ul>
          <p className="copy-14">
            After setup, open the <Link {...link('/')}>Overview</Link> to see what needs attention, or <Link {...link('/health')}>Health</Link> to check that the download client, indexers and disks
            are fine. Set each Profile&rsquo;s Cutoff and size limits in <Link {...link('/settings/slots-profiles')}>Slots &amp; Profiles</Link>.
          </p>
          <p className="copy-14">
            Jellyfin and Plex are not part of setup, and Kestrel works without them. Connect your media servers in Settings, under <Link {...link('/settings/media-servers')}>Media servers</Link>, so
            new files show up at once.
          </p>
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
          <Separator />
          <div className="flex gap-2">
            <Button size="small" variant="primary" disabled={finish.isPending} onClick={() => finish.mutate(undefined, { onSuccess: onLeave })}>
              Finish Setup
            </Button>
            {completed && (
              <Button size="small" onClick={onLeave}>
                Back to Kestrel
              </Button>
            )}
          </div>
        </Fieldset.Content>
      </Fieldset>
    </section>
  )
}

/** Whether a step must be done or can be skipped. */
function Need({ need }: { need: 'required' | 'optional' }) {
  return (
    <Badge size="sm" contrast="low" variant={need === 'required' ? 'blue' : 'gray'}>
      {need === 'required' ? 'Required' : 'Optional'}
    </Badge>
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

function SlotsSummary() {
  const { data: slots } = useSlots()
  const { data: profiles } = useProfiles()
  if (!slots || !profiles) return null
  const name = (key: string | null) => (key ? (profiles.find((p) => p.key === key)?.name ?? key) : 'none')
  return <>{slots.map((s) => `${s.label}: Movies ${name(s.default_movies)}, Series ${name(s.default_series)}${s.on_for_new_titles ? '' : ' (off for new Titles)'}`).join(' · ')}</>
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
  need,
  description,
  state,
  checked,
  summary,
  children,
}: {
  n: number
  id: string
  title: string
  /** Required to finish setup, or can be skipped. */
  need: 'required' | 'optional'
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
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Fieldset.Title as="h2" id={`wizard-${id}`}>
                <span className="flex items-center gap-2">
                  <span aria-hidden>
                    <Badge size="sm" contrast="low" variant={done ? 'green' : 'gray'}>
                      {done ? <Check className="size-3" /> : n}
                    </Badge>
                  </span>
                  {title}
                </span>
              </Fieldset.Title>
              <Need need={need} />
            </div>
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
