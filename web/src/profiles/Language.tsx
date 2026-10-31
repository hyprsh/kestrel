import { Button, Input, Note, Select } from '@hyprsh/design'
import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings, type Settings } from '../api/queries'
import { useReport } from '../toasts'

type Language = Settings['language_region']['primary_language']

const languages: { value: Language; label: string; country: string }[] = [
  { value: 'en', label: 'English', country: 'US' },
  { value: 'de', label: 'German', country: 'DE' },
  { value: 'fr', label: 'French', country: 'FR' },
]

const languageName = (l: Language) => languages.find((x) => x.value === l)?.label ?? l

/**
 * The household's Primary Language and release-date country, shared by the
 * wizard and Settings. Picking a language prefills the country (US, DE, FR);
 * the country stays editable.
 */
export function LanguageForm() {
  const { data, isError } = useSettings()
  if (isError)
    return (
      <Note variant="error" size="small">
        Could not load the language settings.
      </Note>
    )
  if (!data) return null
  // A re-mount when the Language settles (or the change fails) puts the form back on what is saved.
  const pending = data.language_region.pending_primary_language
  return <Form key={`${data.language_region.primary_language}/${pending ?? ''}`} saved={data.language_region} declared={data.from_config_file.language_region} />
}

function Form({ saved, declared }: { saved: Settings['language_region']; declared: boolean }) {
  const pending = saved.pending_primary_language
  const [language, setLanguage] = useState<Language>(pending ?? saved.primary_language)
  const [country, setCountry] = useState(saved.release_date_country)
  const save = usePatchSettings()
  const report = useReport()

  const pick = (value: Language) => {
    setLanguage(value)
    setCountry(languages.find((l) => l.value === value)?.country ?? country)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void report(save.mutateAsync({ language_region: { primary_language: language, release_date_country: country.trim().toUpperCase() } }), {
      started: (s) => (s.language_region.pending_primary_language ? `Re-scoring under ${languageName(s.language_region.pending_primary_language)} in the background` : ''),
      done: 'Language saved',
    })
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
      <p className="copy-13 text-gray-900">
        The Primary Language sets the required audio of your Profiles, what DL and MULTi mean in release names, and the language of title search. Changing it later re-scores every file you already
        have under the new Profiles, without renaming or searching.
      </p>
      <Select
        size="small"
        label="Primary Language"
        value={language}
        disabled={declared || !!pending}
        onChange={(e) => pick(e.target.value as Language)}
        options={languages.map((l) => ({ value: l.value, label: l.label }))}
      />
      <Input size="small" label="Release-date country" maxLength={2} value={country} disabled={declared || !!pending} onChange={(e) => setCountry(e.target.value.toUpperCase())} className="w-24" />
      <p className="copy-13 text-gray-900">The country decides when a Title counts as released. It follows the language until you edit it.</p>
      {save.isError && (
        <Note variant="error" size="small">
          {save.error instanceof ApiError && save.error.status === 422 ? save.error.message : 'Could not save. Try again.'}
        </Note>
      )}
      <Button size="small" variant="primary" typeName="submit" disabled={save.isPending || declared || !!pending} className="self-start">
        Save language
      </Button>
      {pending && <Note size="small">Switching to {languageName(pending)}… Every file is re-scored first. The new Language applies when that ends, and Activity shows how far it is.</Note>}
      {declared && <Note size="small">The Config File sets the language and country, so they cannot be changed here. Change the file and restart Kestrel instead.</Note>}
    </form>
  )
}
