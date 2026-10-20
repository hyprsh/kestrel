// Search now and Manual search for one Version on the Title page.
import { useSearchNow } from '../api/grabs'
import { Button, ErrorText } from '../forms'

/**
 * Search now runs the automatic search for the Version at once (a Series in
 * full, once per season); it only has something to do while the Version is
 * Wanted. Manual search lists every Release to pick from.
 */
export function VersionSearch({ versionId, wanted, onManualSearch }: { versionId: number; wanted: boolean; onManualSearch: () => void }) {
  const search = useSearchNow()
  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          className="h-7 flex-1"
          disabled={!wanted || search.isPending}
          title={wanted ? undefined : 'Nothing in this Version is Wanted'}
          onClick={() => search.mutate({ versionId })}
        >
          Search now
        </Button>
        <Button variant="secondary" className="h-7 flex-1" onClick={onManualSearch}>
          Manual search
        </Button>
      </div>
      {search.isSuccess && <p className="mt-1 text-[12px] text-gray-900">Searching… The Log shows what it grabs.</p>}
      {search.isError && <ErrorText>{search.error.message}</ErrorText>}
    </div>
  )
}
