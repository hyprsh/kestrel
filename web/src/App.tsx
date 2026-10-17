import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Shell } from './shell/Shell'

export function App({ client }: { client?: QueryClient }) {
  const [fallback] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }))
  return (
    <QueryClientProvider client={client ?? fallback}>
      <Shell />
    </QueryClientProvider>
  )
}
