// PROTOTYPE, throwaway. Variant C Settings: one page, two-column form rows grouped by heading, on-page jump list.
import { useState, type ReactNode } from 'react'
import { Copy, RefreshCw, Wand } from 'lucide-react'
import { go } from '../../nav'
import { SLOTS, settings, type Kind } from '../../mock'
import { Badge, Button, Input, Select, Toggle, cx } from '../../ui'
import { useStore } from './store'
import { Segmented, fmtDate } from './bits'

const groups = [
  { id: 'language', label: 'Language & region' },
  { id: 'kids', label: 'Kids rule' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'trash', label: 'TRaSH data' },
  { id: 'indexers', label: 'Indexers' },
  { id: 'sabnzbd', label: 'SABnzbd' },
  { id: 'folders', label: 'Media folders' },
  { id: 'metadata', label: 'Metadata provider keys' },
  { id: 'api', label: 'API key' },
]

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`set-${id}`} className="scroll-mt-4 pb-8">
      <h2 className="border-b border-gray-alpha-400 pb-2 text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 border-b border-gray-alpha-400 py-3.5 last:border-b-0">
      <div>
        <div className="font-medium">{label}</div>
        {help && <div className="mt-0.5 text-[12px] text-gray-900">{help}</div>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function Settings() {
  const s = useStore()
  const [lang, setLang] = useState(settings.primaryLanguage)
  const [country, setCountry] = useState(settings.releaseCountry)
  const [display, setDisplay] = useState(settings.displayLanguage)
  const [active, setActive] = useState('language')

  const setProfile = (id: string, patch: Partial<(typeof s.profiles)[number]>) => s.setProfiles(s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const setDefault = (id: string, kind: Kind, on: boolean) => {
    const slot = s.profiles.find((p) => p.id === id)!.slot
    s.setProfiles(s.profiles.map((p) => (p.slot !== slot ? p : { ...p, defaultFor: p.id === id && on ? [...new Set([...p.defaultFor, kind])] : p.defaultFor.filter((k) => k !== kind) })))
  }

  return (
    <div className="flex h-full">
      <nav className="w-52 shrink-0 border-r border-gray-alpha-400 px-3 py-6">
        <div className="mb-2 px-2 text-[11px] font-medium text-gray-900">On this page</div>
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setActive(g.id)
              document.getElementById(`set-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className={cx('block w-full rounded-md px-2 py-1 text-left', active === g.id ? 'bg-gray-alpha-200 text-gray-1000' : 'text-gray-900 hover:text-gray-1000')}
          >
            {g.label}
          </button>
        ))}
        <div className="mt-4 border-t border-gray-alpha-400 pt-3">
          <button onClick={() => go('wizard')} className="flex items-center gap-1.5 px-2 text-blue-900 hover:underline">
            <Wand className="size-3.5" /> Run setup again
          </button>
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-8 py-6 pb-24">
          <h1 className="mb-6 text-xl font-semibold tracking-tight">Settings</h1>

          <Group id="language" title="Language & region">
            <Row label="Primary Language" help="The household's own language. Primary-Language Profiles require its audio; Dual-Language Releases (DL / MULTi) carry it plus the Original Language.">
              <Segmented value={lang} onChange={setLang} options={['English', 'German', 'French'].map((l) => ({ value: l, label: l }))} />
            </Row>
            <Row label="Release-date country" help="Which country's release dates and age ratings Kestrel uses. Germany means FSK ratings and German digital release dates.">
              <Select value={country} onChange={setCountry} options={['DE', 'AT', 'CH', 'US', 'GB', 'FR']} />
              <span className="text-[12px] text-gray-900">{country === 'DE' || country === 'AT' ? 'Ratings: FSK' : country === 'US' ? 'Ratings: MPA' : country === 'FR' ? 'Ratings: CNC' : 'Ratings: local'}</span>
            </Row>
            <Row label="Display language" help="Language of Kestrel's own interface. Doesn't change what gets downloaded.">
              <Select value={display} onChange={setDisplay} options={['English', 'German', 'French']} />
            </Row>
          </Group>

          <Group id="kids" title="Kids rule">
            <Row label="Kids rule" help="New Titles rated at or below the threshold get the Kids Profile in the HD Slot (SD Releases allowed, English fallback).">
              <Toggle on={s.kidsRule.on} onChange={(on) => s.setKidsRule({ ...s.kidsRule, on })} label={s.kidsRule.on ? 'On' : 'Off'} />
            </Row>
            <Row label="Threshold" help="Age rating in the release-date country.">
              <Segmented value={String(s.kidsRule.threshold)} onChange={(v) => s.setKidsRule({ ...s.kidsRule, threshold: Number(v) as 0 | 6 | 12 })} options={['0', '6', '12'].map((v) => ({ value: v, label: `FSK ${v}` }))} />
            </Row>
          </Group>

          <Group id="profiles" title="Profiles">
            <p className="py-2 text-[12px] text-gray-900">Each Profile belongs to one Slot. Defaults decide which Versions new Titles get; at most one default per Slot and kind. HD is the standard Slot.</p>
            <div className="overflow-hidden rounded-lg border border-gray-alpha-400">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead>
                  <tr className="border-b border-gray-alpha-400 bg-background-200 text-[11px] text-gray-900 [&>th]:px-2.5 [&>th]:py-1.5 [&>th]:font-medium">
                    <th>Slot</th>
                    <th>Profile</th>
                    <th>Requires</th>
                    <th>TRaSH backing</th>
                    <th className="text-center">Enabled</th>
                    <th className="text-center">Default Movies</th>
                    <th className="text-center">Default Series</th>
                    <th className="text-center">English fallback</th>
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.flatMap((slot) =>
                    s.profiles
                      .filter((p) => p.slot === slot)
                      .map((p, i) => (
                        <tr key={p.id} className={cx('border-b border-gray-alpha-400 last:border-b-0 [&>td]:px-2.5 [&>td]:py-1.5', !p.enabled && 'text-gray-900')}>
                          <td className="font-mono font-semibold">{i === 0 ? slot : ''}</td>
                          <td className="font-medium">
                            {p.name} {p.kids && <Badge tone="purple">Kids</Badge>}
                          </td>
                          <td className="whitespace-nowrap">{p.requires === 'primary' ? `Primary (${lang})` : 'Original'}</td>
                          <td className="max-w-56 truncate font-mono text-[11px] text-gray-900" title={p.backing}>
                            {p.backing}
                          </td>
                          <td className="text-center">
                            <input type="checkbox" className="size-3.5 accent-[var(--ds-gray-1000)]" checked={p.enabled} onChange={(e) => setProfile(p.id, { enabled: e.target.checked })} />
                          </td>
                          {(['movie', 'series'] as Kind[]).map((k) => (
                            <td key={k} className="text-center">
                              <input type="checkbox" className="size-3.5 accent-[var(--ds-gray-1000)]" disabled={!p.enabled} checked={p.defaultFor.includes(k)} onChange={(e) => setDefault(p.id, k, e.target.checked)} />
                            </td>
                          ))}
                          <td className="text-center">
                            {p.requires === 'primary' ? (
                              <input type="checkbox" className="size-3.5 accent-[var(--ds-gray-1000)]" checked={!!p.englishFallback} onChange={(e) => setProfile(p.id, { englishFallback: e.target.checked })} />
                            ) : (
                              <span className="text-gray-700">—</span>
                            )}
                          </td>
                        </tr>
                      )),
                  )}
                </tbody>
              </table>
            </div>
          </Group>

          <Group id="trash" title="TRaSH data">
            <Row label="Snapshot" help="Profiles and custom format scores come from a pinned TRaSH Guides snapshot. Updating rescores Releases; existing files are only replaced by Upgrades.">
              <span className="font-mono">{fmtDate(s.trashSnapshot)}</span>
              {s.trashSnapshot === settings.trash.latest ? <Badge tone="green">Latest</Badge> : <Badge tone="amber">{fmtDate(settings.trash.latest)} available</Badge>}
              <Button size="sm" prefix={<RefreshCw className="size-3.5" />} onClick={s.updateTrash}>
                Update from TRaSH
              </Button>
            </Row>
          </Group>

          <Group id="indexers" title="Indexers">
            {s.indexers.map((i) => (
              <Row
                key={i.name}
                label={i.name}
                help={
                  <>
                    {i.limit} · {i.used} · {i.idSearch ? 'ID search' : 'title search only'}
                  </>
                }
              >
                <Input className="h-8! flex-1 font-mono text-[12px]" defaultValue={i.url} />
                {i.status === 'paused' ? <Badge tone="amber">{i.pausedUntil}</Badge> : <Badge tone="green">OK</Badge>}
                <Button size="sm" onClick={() => s.toast(`${i.name}: OK · ${i.idSearch ? 'ID search supported' : 'no ID search'}`)}>
                  Test
                </Button>
              </Row>
            ))}
            <div className="pt-3">
              <Button size="sm" onClick={() => s.toast('Prototype: the add-indexer form would open here')}>
                Add indexer
              </Button>
            </div>
          </Group>

          <Group id="sabnzbd" title="SABnzbd">
            <Row label="URL" help="Where Kestrel hands every Grab.">
              <Input className="h-8! flex-1 font-mono text-[12px]" defaultValue={settings.sabnzbd.url} />
            </Row>
            <Row label="Category" help="Kestrel's downloads land in this SABnzbd category.">
              <Input className="h-8! w-48 font-mono text-[12px]" defaultValue={settings.sabnzbd.category} />
            </Row>
            <Row label="Status">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-green-700" />
                {settings.sabnzbd.status}
              </span>
              <Button size="sm" onClick={() => s.toast('SABnzbd: Connected · v4.5.3')}>
                Test connection
              </Button>
            </Row>
          </Group>

          <Group id="folders" title="Media folders">
            {settings.rootFolders.map((f) => (
              <Row key={f.path} label={f.kind === 'movie' ? 'Movies root folder' : 'Series root folder'} help={`${f.free} free`}>
                <Input className="h-8! flex-1 font-mono text-[12px]" defaultValue={f.path} />
              </Row>
            ))}
            <Row label="Download folders" help="Where SABnzbd puts completed downloads before Import.">
              <span className="font-mono text-[12px]">{settings.downloadFolders.movie}</span>
              <span className="font-mono text-[12px]">{settings.downloadFolders.series}</span>
            </Row>
          </Group>

          <Group id="metadata" title="Metadata provider keys">
            <Row label="TMDB API key" help="Kestrel ships with an embedded key. Set your own to override it.">
              <Input className="h-8! flex-1 font-mono text-[12px]" placeholder="embedded" />
            </Row>
            <Row label="TheTVDB API key" help="Used for Series episodes.">
              <Input className="h-8! flex-1 font-mono text-[12px]" placeholder="embedded" />
            </Row>
            <Row label="Last refresh">
              <span className="font-mono">{settings.metadata.lastRefresh}</span>
            </Row>
          </Group>

          <Group id="api" title="API key">
            <Row label="Kestrel API key" help="For Silo and other tools that send Requests.">
              <span className="rounded-md border border-gray-alpha-400 bg-background-200 px-2 py-1 font-mono text-[12px]">{settings.apiKey}</span>
              <Button size="sm" variant="tertiary" prefix={<Copy className="size-3.5" />} onClick={() => s.toast('API key copied')}>
                Copy
              </Button>
              <Button size="sm" onClick={() => s.toast('New API key generated; Silo needs the new one')}>
                Regenerate
              </Button>
            </Row>
          </Group>
        </div>
      </div>
    </div>
  )
}
