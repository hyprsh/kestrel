import { Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError, useCreateAccount } from '../api/queries'
import { Button, ErrorText, Field, TextInput } from '../forms'
import { KestrelLogo } from '../ui'

const MIN_PASSWORD = 8

/**
 * The setup wizard. A fresh instance lands here for every page. Account comes
 * first; whoever reaches the instance sets the credentials, and finishing the
 * step logs them in. The other sections arrive with later tickets.
 */
export function Wizard() {
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
              {create.isSuccess ? <Check className="size-3" /> : 1}
            </span>
            Account
          </h2>
          <p className="mb-4 text-gray-900">Create the admin login. Kestrel is never open without one.</p>
          <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
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
          </form>
        </section>
      </div>
    </div>
  )
}
