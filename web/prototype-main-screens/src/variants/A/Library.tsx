// PROTOTYPE, throwaway. Variant A Library: one dense table, a row per Title, a column per Slot.
import { ArrowUpDown, Plus, Search } from 'lucide-react'
import { SLOTS, isLongMissing, type Title, type Version } from '../../mock'
import { go, navigate, useParam } from '../../nav'
import { Badge, Dot, Poster, Select, cx, versionStatus } from '../../ui'
import { Button, Input, Page, PageHeader, Segmented, Table, td, th } from './shell'
import { fmtDate, nextDate, relDays, useStore } from './store'

type KindFilter = 'all' | 'movie' | 'series'
const STATUSES = ['Any status', 'Missing', 'Long missing', 'Downloading', 'Unreleased'] as const
const SORTS = ['Title A–Z', 'Year (newest)', 'Next date', 'Recently requested'] as const

function matchesStatus(t: Title, s: string) {
  const vs = t.versions
  if (s === 'Missing') return vs.some((v) => v.state === 'missing')
  if (s === 'Long missing') return vs.some(isLongMissing)
  if (s === 'Downloading') return vs.some((v) => v.state === 'downloading')
  if (s === 'Unreleased') return vs.some((v) => v.state === 'unreleased')
  return true
}

export function LibraryScreen() {
  const { titles } = useStore()
  const kind = useParam('kind', 'all') as KindFilter
  const status = useParam('status', 'Any status')
  const q = useParam('q')
  const sort = useParam('sort', 'Title A–Z')

  const rows = titles
    .filter((t) => kind === 'all' || t.kind === kind)
    .filter((t) => matchesStatus(t, status))
    .filter((t) => !q || `${t.title} ${t.primaryTitle ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'Year (newest)') return b.year - a.year
      if (sort === 'Next date') return (nextDate(a) ?? '9999').localeCompare(nextDate(b) ?? '9999')
      if (sort === 'Recently requested') return (b.request?.at ?? '').localeCompare(a.request?.at ?? '')
      return a.title.localeCompare(b.title)
    })

  const count = (s: string) => titles.filter((t) => matchesStatus(t, s)).length
  const movies = titles.filter((t) => t.kind === 'movie').length

  return (
    <>
      <PageHeader
        title="Library"
        sub={
          <span className="tabular">
            {movies} Movies · {titles.length - movies} Series · {count('Missing')} with missing Versions
          </span>
        }
        actions={
          <Button variant="primary" prefix={<Plus className="size-4" />} onClick={() => navigate({ add: '1' })}>
            Add Title
          </Button>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented<KindFilter>
            value={kind}
            onChange={(v) => navigate({ kind: v === 'all' ? null : v }, true)}
            options={[
              { key: 'all', label: 'All' },
              { key: 'movie', label: 'Movies' },
              { key: 'series', label: 'Series' },
            ]}
          />
          <div className="flex h-9 items-center gap-1 rounded-md border border-gray-alpha-400 bg-background-200 p-0.5">
            {STATUSES.slice(1).map((s) => (
              <button
                key={s}
                onClick={() => navigate({ status: status === s ? null : s }, true)}
                className={cx(
                  'flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-[13px]',
                  status === s ? 'bg-background-100 font-medium text-gray-1000 shadow-[0_0_0_1px_var(--ds-gray-alpha-400)]' : 'text-gray-900 hover:text-gray-1000',
                )}
              >
                <Dot tone={s === 'Missing' ? 'amber' : s === 'Long missing' ? 'red' : s === 'Downloading' ? 'blue' : 'gray'} />
                {s}
                <span className="tabular text-[11px] text-gray-900">{count(s)}</span>
              </button>
            ))}
          </div>
          <Input
            className="ml-auto w-64"
            prefix={<Search className="size-4" />}
            placeholder="Search Titles…"
            value={q}
            onChange={(e) => navigate({ q: e.target.value || null }, true)}
          />
          <div className="flex items-center gap-1.5 text-gray-900">
            <ArrowUpDown className="size-4" />
            <Select value={sort} options={[...SORTS]} onChange={(v) => navigate({ sort: v }, true)} />
          </div>
        </div>

        <Table
          head={
            <>
              <th className={cx(th, 'w-12')} />
              <th className={th}>Title</th>
              <th className={th}>Kind</th>
              <th className={cx(th, 'text-right')}>Year</th>
              {SLOTS.map((s) => (
                <th key={s} className={cx(th, 'w-[150px]')}>
                  <span className="font-mono">{s}</span>
                </th>
              ))}
              <th className={th}>Next</th>
              <th className={th}>Request</th>
            </>
          }
        >
          {rows.map((t) => (
            <tr key={t.id} onClick={() => go('title', { id: t.id })} className="cursor-pointer hover:bg-gray-alpha-100">
              <td className={cx(td, 'py-2')}>
                <Poster title={t.title} hue={t.hue} small className="w-8 rounded" />
              </td>
              <td className={td}>
                <div className="font-medium">{t.title}</div>
                {t.primaryTitle && t.primaryTitle !== t.title ? <div className="text-[12px] text-gray-900">{t.primaryTitle}</div> : <div className="text-[12px] text-gray-700">{t.status}</div>}
              </td>
              <td className={td}>
                <Badge tone={t.kind === 'movie' ? 'gray' : 'purple'}>{t.kind === 'movie' ? 'Movie' : 'Series'}</Badge>
              </td>
              <td className={cx(td, 'tabular text-right text-gray-900')}>{t.year}</td>
              {SLOTS.map((s) => {
                const v = t.versions.find((x) => x.slot === s)
                return (
                  <td key={s} className={td}>
                    {v ? <SlotCell v={v} /> : <AddCell onClick={() => go('title', { id: t.id, tab: 'versions', addSlot: s })} />}
                  </td>
                )
              })}
              <td className={cx(td, 'tabular whitespace-nowrap')}>
                {nextDate(t) ? (
                  <>
                    <div>{fmtDate(nextDate(t)!)}</div>
                    <div className="text-[12px] text-gray-900">{relDays(nextDate(t)!)}</div>
                  </>
                ) : (
                  <span className="text-gray-700">—</span>
                )}
              </td>
              <td className={cx(td, 'whitespace-nowrap')}>
                {t.request ? (
                  <>
                    <div>
                      {t.request.by} <span className="text-gray-900">via {t.request.source}</span>
                    </div>
                    <div className="tabular text-[12px] text-gray-900">{t.request.at.slice(0, 10)}</div>
                  </>
                ) : (
                  <span className="text-gray-700">Added in Kestrel</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className="px-3 py-12 text-center text-gray-900">
                No Titles match these filters.
              </td>
            </tr>
          )}
        </Table>
        <div className="tabular mt-3 text-[12px] text-gray-900">
          Showing {rows.length} of {titles.length} Titles
        </div>
      </Page>
    </>
  )
}

function SlotCell({ v }: { v: Version }) {
  const { profileById } = useStore()
  const s = versionStatus(v)
  const p = profileById(v.profileId)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 truncate font-medium">
        <Dot tone={s.tone} />
        {p.name}
      </div>
      <div className={cx('tabular truncate pl-3.5 text-[12px]', s.tone === 'red' ? 'text-red-900' : s.tone === 'amber' ? 'text-amber-900' : s.tone === 'blue' ? 'text-blue-900' : 'text-gray-900')}>
        {s.label}
        {v.file && <span className="text-gray-900"> · {v.file.quality}</span>}
      </div>
    </div>
  )
}

function AddCell({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-gray-alpha-400 px-2 text-[12px] text-gray-700 hover:border-gray-600 hover:text-gray-1000"
    >
      + add
    </button>
  )
}
