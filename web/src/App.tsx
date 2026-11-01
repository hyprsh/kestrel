import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'
import { useAuth, useSetup } from './api/queries'
import { PageSkeleton } from './loading'
import { Toast } from '@hyprsh/design'
import { Shell } from './shell/Shell'

// The login card, the wizard and the Requester app are separate chunks: a signed-in admin loads only the Shell.
const RequesterApp = lazy(() => import('./requester/RequesterApp').then((m) => ({ default: m.RequesterApp })))
const Login = lazy(() => import('./screens/Login').then((m) => ({ default: m.Login })))
const Wizard = lazy(() => import('./screens/Wizard').then((m) => ({ default: m.Wizard })))

export function App({ client }: { client?: QueryClient }) {
  // The live stream keeps what a screen shows current, so a query another component asks for again within a few seconds
  // (the session, the attention strip, the status) is answered from the cache instead of fetched once per component that mounts.
  const [fallback] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } }))
  return (
    <QueryClientProvider client={client ?? fallback}>
      <Suspense fallback={<PageSkeleton />}>
        <Gate />
      </Suspense>
      {/* One host for every screen; useToasts' own fallback host does not mount under React 19. */}
      <Toast />
    </QueryClientProvider>
  )
}

/**
 * The instance is never open without a login: a fresh one shows the wizard's
 * Account section for every page, an existing one shows the login card until
 * the session is valid. A logged-in admin gets the Shell; a Requester (signed in
 * with Plex) gets the Requester app and nothing else.
 */
function Gate() {
  const { data, isError } = useAuth()
  if (isError) return <div className="flex h-full items-center justify-center text-gray-900">Offline: cannot reach Kestrel.</div>
  if (!data) return <PageSkeleton />
  switch (data.state) {
    case 'setup_required':
      return <Wizard signedIn={false} onLeave={() => {}} />
    case 'unauthenticated':
      return <Login />
    case 'ok':
      return data.me.role === 'requester' ? <RequesterApp name={data.me.username} /> : <AdminGate />
  }
}

/** Until setup is finished, a logged-in admin gets the wizard; Settings can run it again later. */
function AdminGate() {
  const setup = useSetup()
  const [rerun, setRerun] = useState(false)
  if (!setup.data) return <PageSkeleton />
  return !setup.data.completed || rerun ? <Wizard signedIn onLeave={() => setRerun(false)} /> : <Shell onRunSetup={() => setRerun(true)} />
}
