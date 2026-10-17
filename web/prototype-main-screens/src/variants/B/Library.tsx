// PROTOTYPE, throwaway. Variant B · Posters: the library poster grid, home of the app.
import { useState } from 'react'
import { Plus, SearchX } from 'lucide-react'
import { go } from '../../nav'
import { isLongMissing, type Title } from '../../mock'
import { Poster, cx } from '../../ui'
import { Button, Chip, Segmented, useStore, versionPill } from './common'

type KindFilter = 'all' | 'movie' | 'series'
const chips = [
  { key: 'missing', label: 'Missing', test: (t: Title) => t.versions.some((v) => v.state === 'missing') },
  { key: 'downloading', label: 'Downloading', test: (t: Title) => t.versions.some((v) => v.state === 'downloading') },
  { key: 'unreleased', label: 'Unreleased', test: (t: Title) => t.versions.some((v) => v.state === 'unreleased') },
  { key: 'requested', label: 'Requested', test: (t: Title) => !!t.request },
]

export function Library({ query, clearQuery }: { query: string; clearQuery: () => void }) {
  const { titles } = useStore()
  const [kind, setKind] = useState<KindFilter>('all')
  const [active, setActive] = useState<string[]>([])
  const [sort, setSort] = useState<'added' | 'az' | 'year'>('added')

  const q = query.trim().toLowerCase()
  const byKind = titles.filter((t) => kind === 'all' || t.kind === kind)
  let shown = byKind.filter((t) => !q || t.title.toLowerCase().includes(q) || t.primaryTitle?.toLowerCase().includes(q))
  if (active.length) shown = shown.filter((t) => chips.some((c) => active.includes(c.key) && c.test(t)))
  if (sort === 'az') shown = [...shown].sort((a, b) => a.title.localeCompare(b.title))
  if (sort === 'year') shown = [...shown].sort((a, b) => b.year - a.year)

  const toggle = (k: string) => setActive((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))
  const filtered = !!q || active.length > 0

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented<KindFilter>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: <>All <Count n={titles.length} /></> },
            { value: 'movie', label: <>Movies <Count n={titles.filter((t) => t.kind === 'movie').length} /></> },
            { value: 'series', label: <>Series <Count n={titles.filter((t) => t.kind === 'series').length} /></> },
          ]}
        />
        <div className="mx-1 h-5 w-px bg-gray-alpha-400" />
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <Chip key={c.key} active={active.includes(c.key)} onClick={() => toggle(c.key)} count={byKind.filter(c.test).length}>
              {c.label}
            </Chip>
          ))}
          {active.length > 0 && (
            <button onClick={() => setActive([])} className="px-1 text-[13px] text-gray-900 hover:text-gray-1000">Reset</button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3 text-[13px] text-gray-900">
          <span className="tabular">{shown.length} {shown.length === 1 ? 'Title' : 'Titles'}{q && <> matching “{query}”</>}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 rounded-md border border-gray-alpha-400 bg-background-100 px-2 text-[13px] text-gray-1000 outline-none">
            <option value="added">Recently added</option>
            <option value="az">Title A–Z</option>
            <option value="year">Year</option>
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-alpha-400 py-24 text-center">
          <SearchX className="text-gray-700" size={28} />
          <div className="text-[15px] font-semibold tracking-tight">No Titles match</div>
          <p className="max-w-sm text-sm text-gray-900">Nothing in the library fits these filters. Add a Title, or clear the search and filters.</p>
          <div className="mt-2 flex gap-2">
            {filtered && <Button size="sm" onClick={() => (clearQuery(), setActive([]), setKind('all'))}>Clear filters</Button>}
            <Button size="sm" variant="primary" prefix={<Plus size={14} />} onClick={() => go('add')}>Add Title</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {shown.map((t) => <PosterCard key={t.id} t={t} />)}
        </div>
      )}
    </div>
  )
}

const Count = ({ n }: { n: number }) => <span className="tabular text-[11px] text-gray-700">{n}</span>

function PosterCard({ t }: { t: Title }) {
  const downloading = t.versions.find((v) => v.state === 'downloading')
  const longMissing = t.versions.some(isLongMissing)
  return (
    <button onClick={() => go('title', { id: t.id })} className="group flex flex-col text-left outline-none">
      <div className="relative w-full overflow-hidden rounded-lg ring-gray-1000 transition-shadow group-hover:shadow-lg group-focus-visible:ring-2">
        <Poster title={t.title} hue={t.hue} className="w-full rounded-lg transition-transform duration-300 group-hover:scale-[1.02]" />
        <div className="absolute top-2 left-2 flex gap-1">
          {t.versions.map((v) => (
            <span key={v.slot} className="rounded bg-background-100/85 p-px backdrop-blur">{versionPill(v)}</span>
          ))}
        </div>
        {longMissing && (
          <span title="Long missing: a Version has been searchable for 90+ days without a Release" className="absolute top-0 right-0 size-7 bg-red-700 [clip-path:polygon(0_0,100%_0,100%_100%)]" />
        )}
        {downloading && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40" title={`${downloading.slot} downloading ${downloading.progress}%`}>
            <div className="h-full bg-blue-700" style={{ width: `${downloading.progress}%` }} />
          </div>
        )}
      </div>
      <div className="mt-2.5 min-w-0">
        <div className="truncate text-sm font-medium tracking-tight group-hover:underline">{t.title}</div>
        {t.primaryTitle && t.primaryTitle !== t.title && <div className="truncate text-[13px] text-gray-900">{t.primaryTitle}</div>}
        <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-gray-900">
          <span className="tabular">{t.year}</span>
          <span className="text-gray-600">·</span>
          <span>{t.kind === 'movie' ? 'Movie' : 'Series'}</span>
          {t.request && (
            <span title={`Requested by ${t.request.by} via ${t.request.source}`} className={cx('ml-auto rounded px-1.5 py-px text-[10px] font-semibold tracking-wide', 'bg-purple-100 text-purple-900')}>
              {t.request.source}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

