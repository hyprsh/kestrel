// PROTOTYPE, throwaway. Variant C Overview: "does anything need me?" first, then what Kestrel is doing on its own.
import { useState, type ReactNode } from 'react'
import { ArrowUpRight, Ban, CircleAlert, CircleCheck, HardDrive, Pause, RefreshCw, Search, Server } from 'lucide-react'
import { go } from '../../nav'
import { TODAY, daysBetween, isLongMissing, profileById, settings, upcoming, type Slot } from '../../mock'
import { Badge, Button, cx, fmtNum } from '../../ui'
import { useStore } from './store'
import { LinkButton, Meter, Page, SectionHead, SlotDots, ago, eventTone, fmtDate, fmtDay, fmtWhen, hoursAgo, span, useListNav } from './bits'

/** Everything the Overview lists under "Needs attention"; also drives the rail badge. */
export function useAttention() {
  const s = useStore()
  const longMissing = s.titles
    .flatMap((t) => t.versions.filter(isLongMissing).map((v) => ({ t, v })))
    .sort((a, b) => a.v.missingSince!.localeCompare(b.v.missingSince!))
  const failures = s.history.filter((h) => (h.type === 'Failed' || h.type === 'Blocklisted') && hoursAgo(h.at) <= 24)
  const paused = s.indexers.filter((i) => i.status === 'paused')
  return { longMissing, failures, paused, count: longMissing.length + failures.length + paused.length }
}

type Row = { key: string; open: () => void; node: (active: boolean) => ReactNode }

function RowShell({ active, onClick, idx, children, className }: { active: boolean; onClick: () => void; idx: number; children: ReactNode; className?: string }) {
  return (
    <div
      data-nav={`ov-${idx}`}
      onClick={onClick}
      className={cx('group flex cursor-pointer items-center gap-3 border-b border-gray-alpha-400 px-3 py-2 last:border-b-0', active ? 'bg-gray-alpha-200' : 'hover:bg-gray-alpha-100', className)}
    >
      {children}
    </div>
  )
}

const SlotTag = ({ slot }: { slot: Slot }) => <span className="rounded border border-gray-alpha-400 px-1 font-mono text-[11px] text-gray-1000">{slot}</span>

export function Overview() {
  const s = useStore()
  const att = useAttention()
  const [sel, setSel] = useState(0)

  const week = upcoming.filter((u) => {
    const d = daysBetween(TODAY, u.date)
    return d >= 0 && d <= 7
  })
  const recent = s.history.filter((h) => h.type === 'Imported' || h.type === 'Upgraded' || h.type === 'Adopted').slice(0, 5)

  const attention: Row[] = [
    ...att.longMissing.map(({ t, v }): Row => {
      const days = daysBetween(v.missingSince!, TODAY)
      const lastFail = s.history.find((h) => h.titleId === t.id && h.slot === v.slot && (h.type === 'Failed' || h.type === 'Blocklisted'))
      return {
        key: `lm-${t.id}-${v.slot}`,
        open: () => go('library', { id: t.id }),
        node: () => (
          <>
            <CircleAlert className="size-4 shrink-0 text-red-900" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.title}</span>
                <SlotTag slot={v.slot} />
                <span className="text-red-900">Long missing for {span(days)}</span>
                <span className="text-gray-900">since {fmtDate(v.missingSince!)}</span>
              </div>
              <div className="truncate text-[12px] text-gray-900">
                Profile {profileById(v.profileId).name}
                {v.episodesWanted !== undefined && ` · ${v.episodesHave}/${v.episodesWanted} episodes`} · searched {ago(v.lastSearched)}
                {lastFail && ` · last attempt failed ${fmtWhen(lastFail.at)}: ${lastFail.detail}`}
              </div>
            </div>
            <div className="flex shrink-0 gap-1 opacity-70 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="tertiary"
                className="h-7"
                prefix={<RefreshCw className="size-3.5" />}
                onClick={() => {
                  s.updateVersion(t.id, v.slot, (x) => ({ ...x, lastSearched: TODAY }))
                  s.toast(`Searching ${t.title} · ${v.slot}…`)
                }}
              >
                Search
              </Button>
              <Button size="sm" variant="tertiary" className="h-7" prefix={<Search className="size-3.5" />} onClick={() => go('search', { id: t.id, slot: v.slot })}>
                Manual search
              </Button>
            </div>
          </>
        ),
      }
    }),
    ...att.failures.map(
      (h): Row => ({
        key: h.id,
        open: () => go('activity'),
        node: () => (
          <>
            <Ban className="size-4 shrink-0 text-red-900" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{h.label}</span>
                {h.slot && <SlotTag slot={h.slot} />}
                <Badge tone={eventTone[h.type]}>{h.type}</Badge>
                <span className="truncate text-gray-900">{h.detail}</span>
              </div>
              <div className="truncate font-mono text-[11px] text-gray-900">
                {h.release} · {h.indexer}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[12px] text-gray-900 tabular">{fmtWhen(h.at)}</span>
          </>
        ),
      }),
    ),
    ...att.paused.map(
      (i): Row => ({
        key: `ix-${i.name}`,
        open: () => go('settings'),
        node: () => (
          <>
            <Pause className="size-4 shrink-0 text-amber-900" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Indexer {i.name} paused</span>
                <span className="text-amber-900">{i.pausedUntil}</span>
              </div>
              <div className="text-[12px] text-gray-900">Searches skip it until then; Kestrel resumes it on its own.</div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              <Button
                size="sm"
                variant="tertiary"
                className="h-7"
                onClick={() => {
                  s.setIndexers(s.indexers.map((x) => (x.name === i.name ? { ...x, status: 'ok' as const } : x)))
                  s.toast(`${i.name} resumed`)
                }}
              >
                Resume now
              </Button>
            </div>
          </>
        ),
      }),
    ),
  ]

  const downloading: Row[] = s.queue.map((q) => ({
    key: q.id,
    open: () => go('library', { id: q.titleId }),
    node: () => (
      <>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{q.label}</span>
            <SlotTag slot={q.slot} />
            {q.upgrade && <Badge tone="purple">Upgrade</Badge>}
            <Badge tone={q.phase === 'downloading' ? 'blue' : q.phase === 'importing' ? 'teal' : 'gray'} className="capitalize">
              {q.phase}
            </Badge>
          </div>
          <div className="truncate font-mono text-[11px] text-gray-900">{q.release}</div>
        </div>
        <div className="flex w-56 shrink-0 items-center gap-2">
          <Meter value={q.progress} max={100} tone={q.phase === 'importing' ? 'green' : 'blue'} />
          <span className="w-9 text-right font-mono text-[12px] tabular">{q.progress}%</span>
        </div>
        <span className="w-24 shrink-0 text-right font-mono text-[12px] whitespace-nowrap text-gray-900 tabular">{q.left} left</span>
        <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular">{q.eta}</span>
      </>
    ),
  }))

  const coming: Row[] = week.map((u, i) => ({
    key: `u${i}`,
    open: () => go('library', { id: u.titleId }),
    node: () => (
      <>
        <span className="w-20 shrink-0 text-gray-900">{fmtDay(u.date)}</span>
        <span className="shrink-0 font-medium whitespace-nowrap">{u.label}</span>
        <span className="truncate text-gray-900">{u.what}</span>
        <span className="ml-auto">
          <SlotDots t={s.titles.find((t) => t.id === u.titleId)!} only={u.slots} />
        </span>
      </>
    ),
  }))

  const added: Row[] = recent.map((h) => {
    const m = h.detail.match(/Score ([\d ]+) → ([\d ]+)/)
    const delta = m ? Number(m[2].replace(/\s/g, '')) - Number(m[1].replace(/\s/g, '')) : undefined
    return {
      key: h.id,
      open: () => go('library', { id: h.titleId }),
      node: () => (
        <>
          <Badge tone={eventTone[h.type]} className="w-20 justify-center">
            {h.type}
          </Badge>
          <span className="shrink-0 font-medium whitespace-nowrap">{h.label}</span>
          {h.slot && <SlotTag slot={h.slot} />}
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-900">{h.release ?? h.detail}</span>
          {h.score !== undefined && <span className="font-mono text-[12px] tabular">{fmtNum(h.score)}</span>}
          <span className={cx('w-16 text-right font-mono text-[12px] tabular', delta ? 'text-green-900' : 'text-gray-700')}>{delta ? `+${fmtNum(delta)}` : 'new'}</span>
          <span className="w-32 shrink-0 text-right font-mono text-[12px] whitespace-nowrap text-gray-900 tabular">{fmtWhen(h.at)}</span>
        </>
      ),
    }
  })

  const all = [...attention, ...downloading, ...coming, ...added]
  useListNav('ov', all.length, sel, setSel, (i) => all[i].open())
  let n = 0
  const render = (rows: Row[]) =>
    rows.map((r) => {
      const idx = n++
      return (
        <RowShell key={r.key} idx={idx} active={idx === sel} onClick={() => (setSel(idx), r.open())}>
          {r.node(idx === sel)}
        </RowShell>
      )
    })

  return (
    <Page wide>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{att.count === 0 ? 'Nothing needs you' : `${att.count} ${att.count === 1 ? 'thing needs' : 'things need'} you`}</h1>
          <p className="mt-1 text-gray-900">
            {s.titles.length} Titles · {s.queue.length} in the queue · {week.length} coming this week · everything else runs on its own
          </p>
        </div>
        <Button size="sm" prefix={<RefreshCw className="size-3.5" />} onClick={s.searchAllMissing}>
          Search all missing
        </Button>
      </div>

      <section className="mb-6">
        <SectionHead title="Needs attention" count={attention.length} tone="red" />
        <div className="overflow-hidden rounded-lg border border-gray-alpha-400">
          {attention.length ? (
            render(attention)
          ) : (
            <div className="flex items-center gap-2 px-3 py-3 text-gray-900">
              <CircleCheck className="size-4 text-green-900" /> All clear. Kestrel is handling everything.
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-6">
        <section>
          <SectionHead title="Downloading now" count={downloading.length} tone="blue" right={<span>SABnzbd · 38.2 MB/s</span>} />
          <div className="overflow-hidden rounded-lg border border-gray-alpha-400">{render(downloading)}</div>
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section>
            <SectionHead title="Coming this week" count={coming.length} right={<LinkButton onClick={() => go('upcoming')}>All Upcoming <ArrowUpRight className="size-3" /></LinkButton>} />
            <div className="overflow-hidden rounded-lg border border-gray-alpha-400">{render(coming)}</div>
          </section>
          <section>
            <SectionHead title="Recently added" count={added.length} right={<LinkButton onClick={() => go('activity')}>Log <ArrowUpRight className="size-3" /></LinkButton>} />
            <div className="overflow-hidden rounded-lg border border-gray-alpha-400">{render(added)}</div>
          </section>
        </div>

        <Health />
      </div>
    </Page>
  )
}

function Health() {
  const s = useStore()
  const trashAge = daysBetween(s.trashSnapshot, TODAY)
  const latest = s.trashSnapshot === settings.trash.latest
  const cell = 'flex min-w-0 flex-col gap-1.5 px-3 py-2.5'
  return (
    <section>
      <SectionHead title="Health" />
      <div className="grid grid-cols-2 divide-gray-alpha-400 overflow-hidden rounded-lg border border-gray-alpha-400 md:grid-cols-6 md:divide-x">
        <div className={cell}>
          <span className="flex items-center gap-1.5 text-[12px] text-gray-900">
            <Server className="size-3.5" /> SABnzbd
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-green-700" />
            {settings.sabnzbd.status}
          </span>
        </div>
        {s.indexers.map((i) => {
          const used = Number(i.used.replace(/\D/g, ''))
          const limit = i.limit.startsWith('not') ? undefined : Number(i.limit.split('/')[0].replace(/\D/g, ''))
          return (
            <div key={i.name} className={cell} title={`${i.name}: ${i.used} · limit ${i.limit}`}>
              <span className="flex items-center justify-between text-[12px] text-gray-900">
                {i.name}
                {i.status === 'paused' && <Badge tone="amber">Paused</Badge>}
              </span>
              {limit ? <Meter value={used} max={limit} /> : <Meter value={0} max={1} tone="gray" />}
              <span className="font-mono text-[11px] text-gray-900 tabular">
                {fmtNum(used)} / {limit ? fmtNum(limit) : 'n/a'} API today
              </span>
            </div>
          )
        })}
        <div className={cell}>
          <span className="flex items-center gap-1.5 text-[12px] text-gray-900">
            <HardDrive className="size-3.5" /> Disk
          </span>
          <span className="font-mono tabular">1.8 TB free</span>
          <span className="font-mono text-[11px] text-gray-900">/data</span>
        </div>
        <div className={cell}>
          <span className="text-[12px] text-gray-900">TRaSH snapshot</span>
          <span className="font-mono tabular">
            {s.trashSnapshot} <span className="text-gray-900">· {trashAge} d</span>
          </span>
          {latest ? (
            <span className="text-[11px] text-green-900">Latest</span>
          ) : (
            <button onClick={s.updateTrash} className="text-left text-[11px] text-blue-900 hover:underline">
              {settings.trash.latest} available · Update
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

