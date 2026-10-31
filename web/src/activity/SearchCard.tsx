// The Searching card of Health's Background jobs: the search pipeline in a few lines (SearchSummary) and the button
// that queues every Wanted Version for a search now, the same action as the command menu's "Search all Wanted".
import { Button, useToasts } from '@hyprsh/design'
import type { SearchStatus } from '../api/search'
import { useSearchAllWanted } from '../api/wanted'
import { SectionBlock } from '../layout/SectionBlock'
import { SearchSummary } from './SearchSummary'

export function SearchCard({ status }: { status: SearchStatus }) {
  const searchAll = useSearchAllWanted()
  const toasts = useToasts()
  const running = status.pass !== null
  const nothing = status.due.versions === 0
  const blocked = running || nothing || searchAll.isPending
  const why = running ? 'A search pass is running' : nothing ? 'Nothing is Wanted' : undefined
  return (
    <SectionBlock title="Searching">
      <div className="flex flex-col gap-3 px-4 py-3">
        <SearchSummary status={status} />
        <div className="flex">
          {/* A disabled button takes no hover, so the reason sits on the wrapper. */}
          <span title={why}>
            <Button
              variant="secondary"
              size="small"
              loading={searchAll.isPending}
              disabled={blocked}
              onClick={() =>
                searchAll.mutate(undefined, {
                  onSuccess: (versions) => toasts.success(`${versions} Wanted ${versions === 1 ? 'Version' : 'Versions'} queued for a search`),
                  onError: (e) => toasts.error(`Search all Wanted failed: ${e.message}`),
                })
              }
            >
              Search all Wanted
            </Button>
          </span>
        </div>
      </div>
    </SectionBlock>
  )
}
