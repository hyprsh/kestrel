import { useState, type FormEvent } from 'react'
import { ApiError, useLogin } from '../api/queries'
import { Button, Code, Input, Note } from '@hyprsh/design'
import { PageSurface } from '../layout/PageSurface'
import { KestrelLogo } from '../ui'

function loginErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'rate_limited') return `Too many attempts. Try again in ${error.retryAfter ?? 60} s`
    if (error.code === 'unauthenticated') return 'Wrong username or password'
  }
  return 'Could not reach Kestrel. Try again.'
}

/** The login card: centred, follows the system light/dark choice. */
export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ username, password })
  }

  return (
    <PageSurface>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="heading-16 flex items-center gap-2">
          <KestrelLogo className="size-6" /> Kestrel
        </div>
        <Input label="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {login.isError && (
          <Note variant="error" size="small">
            {loginErrorText(login.error)}
          </Note>
        )}
        <Button variant="primary" typeName="submit" loading={login.isPending}>
          Log in
        </Button>
        <p className="copy-13 text-gray-900">
          Forgot your password? Run <Code>kestrel reset-password</Code> in the container.
        </p>
      </form>
    </PageSurface>
  )
}
