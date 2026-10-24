// chrome: pending
import { useState, type FormEvent } from 'react'
import { ApiError, useLogin } from '../api/queries'
import { Button, Input, Note } from '@hyprsh/design'
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
    <div className="flex h-full items-center justify-center bg-background-200 text-[13px] text-gray-1000">
      <form onSubmit={submit} className="flex w-80 flex-col gap-4 rounded-lg border border-gray-alpha-400 bg-background-100 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <KestrelLogo /> Kestrel
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
        <p className="text-[12px] text-gray-900">
          Forgot your password? Run <code className="font-mono">kestrel reset-password</code> in the container.
        </p>
      </form>
    </div>
  )
}
