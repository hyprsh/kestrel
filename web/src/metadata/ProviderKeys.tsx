import { useState, type FormEvent } from 'react'
import { ApiError, usePatchSettings, useSettings } from '../api/queries'
import { Button, ErrorText, Field, TextInput } from '../forms'

/**
 * The metadata provider keys: an override of the TMDB and TheTVDB keys Kestrel
 * ships with or reads from the environment. The keys are secrets, so the page
 * only learns whether an override is set and never shows it again.
 */
export function ProviderKeysForm() {
  const settings = useSettings()
  const patch = usePatchSettings()
  const [tmdb, setTmdb] = useState('')
  const [tvdb, setTvdb] = useState('')
  if (!settings.data) return null
  const set = settings.data.metadata

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const metadata: { tmdb_api_key?: string; tvdb_api_key?: string } = {}
    if (tmdb.trim()) metadata.tmdb_api_key = tmdb.trim()
    if (tvdb.trim()) metadata.tvdb_api_key = tvdb.trim()
    patch.mutate({ metadata }, { onSuccess: () => (setTmdb(''), setTvdb('')) })
  }
  const clear = (which: 'tmdb_api_key' | 'tvdb_api_key') => patch.mutate({ metadata: { [which]: '' } })

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <Field label="TMDB API key">
        {(id) => (
          <TextInput id={id} type="password" autoComplete="off" value={tmdb} onChange={(e) => setTmdb(e.target.value)} placeholder={set.tmdb_api_key_set ? 'Override saved' : 'Using the built-in key'} />
        )}
      </Field>
      {set.tmdb_api_key_set && (
        <Button type="button" variant="secondary" disabled={patch.isPending} onClick={() => clear('tmdb_api_key')} className="self-start">
          Remove TMDB override
        </Button>
      )}
      <Field label="TheTVDB API key">
        {(id) => (
          <TextInput id={id} type="password" autoComplete="off" value={tvdb} onChange={(e) => setTvdb(e.target.value)} placeholder={set.tvdb_api_key_set ? 'Override saved' : 'Using the built-in key'} />
        )}
      </Field>
      {set.tvdb_api_key_set && (
        <Button type="button" variant="secondary" disabled={patch.isPending} onClick={() => clear('tvdb_api_key')} className="self-start">
          Remove TheTVDB override
        </Button>
      )}
      {patch.isError && <ErrorText>{patch.error instanceof ApiError ? patch.error.message : 'Could not save. Try again.'}</ErrorText>}
      <Button type="submit" disabled={patch.isPending || (!tmdb.trim() && !tvdb.trim())} className="self-start">
        Save keys
      </Button>
    </form>
  )
}
