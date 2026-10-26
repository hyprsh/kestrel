// The app a Requester (someone signed in with Plex) gets instead of the Shell: search for a Title, Request it
// and follow their own Requests, on one screen made for a phone. It calls only what a Requester's session may:
// /auth/me, /auth/logout, /lookup, /titles/{id}/poster and /my/requests.
import { Button } from '@hyprsh/design'
import { useMemo } from 'react'
import { useMyRequests } from '../api/plex'
import { useLogout } from '../api/queries'
import { PhoneTopBar } from '../layout/TopBar'
import { KestrelLogo } from '../ui'
import { MyRequests } from './MyRequests'
import { Search } from './Search'

export function RequesterApp({ name }: { name: string }) {
  const logout = useLogout()
  const mine = useMyRequests()
  const requests = useMemo(() => mine.data?.pages.flatMap((p) => p.items) ?? [], [mine.data])
  return (
    <div className="flex h-full flex-col text-gray-1000">
      <PhoneTopBar
        title={
          <span className="flex items-center gap-2">
            <KestrelLogo className="size-5" /> Kestrel
          </span>
        }
      >
        <span className="label-13 min-w-0 max-w-[45%] truncate text-gray-900">
          <span className="sr-only">Signed in as </span>
          {name}
        </span>
        <Button size="small" variant="tertiary" disabled={logout.isPending} onClick={() => logout.mutate(undefined)}>
          Log out
        </Button>
      </PhoneTopBar>
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-8 p-4">
          <Search requests={requests} />
          <MyRequests list={mine} requests={requests} />
        </div>
      </main>
    </div>
  )
}
