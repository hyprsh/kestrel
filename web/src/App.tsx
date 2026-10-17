import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from './api/queries'
import { Login } from './screens/Login'
import { Wizard } from './screens/Wizard'
import { Shell } from './shell/Shell'

export function App({ client }: { client?: QueryClient }) {
  const [fallback] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }))
  return (
    <QueryClientProvider client={client ?? fallback}>
      <Gate />
    </QueryClientProvider>
  )
}

/**
 * The instance is never open without a login: a fresh one shows the wizard's
 * Account section for every page, an existing one shows the login card until
 * the session is valid.
 */
function Gate() {
  const { data, isError } = useAuth()
  if (isError) return <div className="flex h-full items-center justify-center text-[13px] text-gray-900">Offline: cannot reach Kestrel.</div>
  if (!data) return null
  switch (data.state) {
    case 'setup_required':
      return <Wizard />
    case 'unauthenticated':
      return <Login />
    case 'ok':
      return <Shell />
  }
}
