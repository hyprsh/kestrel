import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth, useSetup } from './api/queries'
import { Login } from './screens/Login'
import { Wizard } from './screens/Wizard'
import { Toast } from '@hyprsh/design'
import { Shell } from './shell/Shell'

export function App({ client }: { client?: QueryClient }) {
  const [fallback] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }))
  return (
    <QueryClientProvider client={client ?? fallback}>
      <Gate />
      {/* One host for every screen; useToasts' own fallback host does not mount under React 19. */}
      <Toast />
    </QueryClientProvider>
  )
}

/**
 * The instance is never open without a login: a fresh one shows the wizard's
 * Account section for every page, an existing one shows the login card until
 * the session is valid. Until setup is finished, a logged-in admin gets the
 * wizard; Settings can run it again later.
 */
function Gate() {
  const { data, isError } = useAuth()
  const setup = useSetup(data?.state === 'ok')
  const [rerun, setRerun] = useState(false)
  if (isError) return <div className="flex h-full items-center justify-center text-gray-900">Offline: cannot reach Kestrel.</div>
  if (!data) return null
  switch (data.state) {
    case 'setup_required':
      return <Wizard signedIn={false} onLeave={() => {}} />
    case 'unauthenticated':
      return <Login />
    case 'ok':
      if (!setup.data) return null
      return !setup.data.completed || rerun ? <Wizard signedIn onLeave={() => setRerun(false)} /> : <Shell onRunSetup={() => setRerun(true)} />
  }
}
