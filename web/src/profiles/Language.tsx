import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings, type Settings } from '../api/queries'
import { Button, ErrorText, Field, Select, TextInput } from '../forms'

type Language = Settings['language_region']['primary_language']

const languages: { value: Language; label: string; country: string }[] = [
  { value: 'en', label: 'English', country: 'US' },
  { value: 'de', label: 'German', country: 'DE' },
  { value: 'fr', label: 'French', country: 'FR' },
]

/**
 * The household's Primary Language and release-date country, shared by the
 * wizard and Settings. Picking a language prefills the country (US, DE, FR);
 * the country stays editable.
 */
export function LanguageForm() {
  const { data, isError } = useSettings()
  if (isError) return <p className="text-[12px] text-red-900">Could not load the language settings.</p>
  if (!data) return null
  return <Form saved={data.language_region} />
}

function Form({ saved }: { saved: Settings['language_region'] }) {
  const [language, setLanguage] = useState<Language>(saved.primary_language)
  const [country, setCountry] = useState(saved.release_date_country)
  const save = usePatchSettings()

  const pick = (value: Language) => {
    setLanguage(value)
    setCountry(languages.find((l) => l.value === value)?.country ?? country)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ language_region: { primary_language: language, release_date_country: country.trim().toUpperCase() } })
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-3">
      <p className="text-[12px] text-gray-900">
        The Primary Language sets the required audio of your Profiles, what DL and MULTi mean in release names, and the language of title search.
        Changing it later re-scores every file you already have under the new Profiles, without renaming or searching.
      </p>
      <Field label="Primary Language">
        {(id) => (
          <Select id={id} value={language} onChange={(e) => pick(e.target.value as Language)}>
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Release-date country">
        {(id) => <TextInput id={id} maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} className="w-24 uppercase" />}
      </Field>
      <p className="text-[12px] text-gray-900">
        The country decides when a Title counts as released and which age rating the Kids rule reads. It follows the language until you edit it.
      </p>
      {save.isError && <ErrorText>{save.error instanceof ApiError && save.error.status === 422 ? save.error.message : 'Could not save. Try again.'}</ErrorText>}
      {save.isSuccess && (
        <p role="status" className="text-[12px] text-green-900">
          Saved.
        </p>
      )}
      <Button type="submit" disabled={save.isPending} className="self-start">
        Save language
      </Button>
    </form>
  )
}
