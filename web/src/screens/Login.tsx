import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePlexAvailable, useFinishPlexSignIn, useStartPlexSignIn } from '../api/plex'
import { ApiError, useLogin } from '../api/queries'
import { Button, Code, Input, Note } from '@hyprsh/design'
import { PageSurface } from '../layout/PageSurface'
import { LoadingLine } from '../loading'
import { KestrelLogo } from '../ui'

function loginErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') return `Too many attempts. Try again in ${error.retryAfter ?? 60} s`
    if (error.code === 'unauthenticated') return 'Wrong username or password'
  }
  return 'Could not reach Kestrel. Try again.'
}

/** What went wrong finishing a Plex sign-in, in plain words. */
function plexErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'plex_no_access') return "This Plex account can't request here. Ask whoever shares the Plex server with you."
    if (error.code === 'unauthenticated') return 'The Plex sign-in expired. Try again.'
    if (error.code === 'rate_limited') return `Too many attempts. Try again in ${error.retryAfter ?? 60} s`
    if (error.code === 'upstream_unavailable') return 'Plex cannot be reached right now. Try again in a moment.'
    if (error.code === 'plex_sign_in_off') return 'Sign in with Plex is switched off.'
    if (error.code === 'pending') return 'Plex has not confirmed the sign-in yet. Try again.'
  }
  return 'Could not finish signing in with Plex. Try again.'
}

/** True when Plex sent the browser back here (`?plex=1`) to finish a sign-in. */
const returnedFromPlex = () => new URLSearchParams(location.search).get('plex') === '1'

/** The login card: centred, follows the system light/dark choice. */
export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()
  const plexAvailable = usePlexAvailable()
  const startPlex = useStartPlexSignIn()
  const finishPlex = useFinishPlexSignIn()
  const [returned] = useState(returnedFromPlex)
  const started = useRef(false)
  const finishing = returned && !finishPlex.isError

  useEffect(() => {
    if (!returned || started.current) return
    started.current = true
    finishPlex.mutate()
  }, [returned, finishPlex])

  const signInWithPlex = () => startPlex.mutate(undefined, { onSuccess: (url) => window.location.assign(url) })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ username, password })
  }

  if (finishing)
    return (
      <PageSurface>
        <div className="heading-16 flex items-center gap-2">
          <KestrelLogo className="size-6" /> Kestrel
        </div>
        <LoadingLine>Signing in with Plex…</LoadingLine>
      </PageSurface>
    )

  return (
    <PageSurface>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="heading-16 flex items-center gap-2">
          <KestrelLogo className="size-6" /> Kestrel
        </div>
        <Input label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {login.isError && (
          <Note variant="error" size="small">
            {loginErrorText(login.error)}
          </Note>
        )}
        <Button variant="primary" typeName="submit" loading={login.isPending}>
          Log in
        </Button>
        {plexAvailable.data && (
          <Button typeName="button" loading={startPlex.isPending} onClick={signInWithPlex}>
            Sign in with Plex
          </Button>
        )}
        {finishPlex.isError && (
          <Note variant="error" size="small">
            {plexErrorText(finishPlex.error)}
          </Note>
        )}
        {startPlex.isError && (
          <Note variant="error" size="small">
            {plexErrorText(startPlex.error)}
          </Note>
        )}
        <p className="copy-13 text-gray-900">
          Forgot your password? Run <Code>kestrel reset-password</Code> in the container.
        </p>
      </form>
    </PageSurface>
  )
}
