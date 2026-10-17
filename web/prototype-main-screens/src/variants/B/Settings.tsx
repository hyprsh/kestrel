// PROTOTYPE, throwaway. Variant B · Posters: Settings as one scrolling page of stacked Geist cards, each with its own Save.
import { useState, type ReactNode } from 'react'
import { Copy, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { profiles as mockProfiles, settings, SLOTS, type Kind, type Profile } from '../../mock'
import { Badge, Dot, Input, Select, Toggle, cx } from '../../ui'
import { Button, Checkbox, Field, PageHeader, Segmented, useStore } from './common'

const sections = [
  ['language', 'Primary Language & region'],
  ['kids', 'Kids rule'],
  ['profiles', 'Profiles'],
  ['trash', 'TRaSH data'],
  ['indexers', 'Indexers'],
  ['sabnzbd', 'SABnzbd'],
  ['folders', 'Media folders'],
  ['metadata', 'Metadata provider keys'],
  ['api', 'API key'],
] as const

export function Settings() {
  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[200px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-36 flex flex-col gap-0.5">
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))} className="rounded-md px-2 py-1.5 text-sm text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000">
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 max-w-[820px]">
        <PageHeader title="Settings" sub="Everything for this household’s library. Each card saves on its own." />
        <div className="space-y-6">
          <LanguageCard />
          <KidsCard />
          <ProfilesCard />
          <TrashCard />
          <IndexersCard />
          <SabCard />
          <FoldersCard />
          <MetadataCard />
          <ApiKeyCard />
        </div>
      </div>
    </div>
  )
}

function Card({ id, title, description, children, footer, onSave }: { id: string; title: string; description: ReactNode; children: ReactNode; footer?: ReactNode; onSave?: () => void }) {
  const { toast } = useStore()
  return (
    <section id={id} className="scroll-mt-36 overflow-hidden rounded-lg border border-gray-alpha-400 bg-background-100">
      <div className="p-6">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1.5 text-sm text-gray-900">{description}</p>
        <div className="mt-5">{children}</div>
      </div>
      <div className="flex min-h-14 items-center justify-between gap-4 border-t border-gray-alpha-400 bg-background-200 px-6 py-3">
        <div className="text-[13px] text-gray-900">{footer}</div>
        <Button size="sm" variant="primary" onClick={() => (onSave?.(), toast(`${title} saved`))}>Save</Button>
      </div>
    </section>
  )
}

function LanguageCard() {
  const [lang, setLang] = useState(settings.primaryLanguage)
  const [country, setCountry] = useState(settings.releaseCountry)
  const [display, setDisplay] = useState(settings.displayLanguage)
  return (
    <Card
      id="language"
      title="Primary Language & region"
      description="The household’s own language. Primary-Language Profiles require its audio, and Kestrel also searches by the Titles’ names in it."
      footer={lang !== settings.primaryLanguage ? <span className="text-amber-900">Changing it re-checks every Version under a Primary-Language Profile.</span> : 'Chosen once for the whole library.'}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Primary Language"><Select value={lang} onChange={setLang} options={['English', 'German', 'French']} /></Field>
        <Field label="Release-date country" hint="Release dates and age ratings (FSK)"><Select value={country} onChange={setCountry} options={['DE', 'AT', 'CH', 'US', 'GB', 'FR']} /></Field>
        <Field label="Display language" hint="Language of Kestrel’s own UI"><Select value={display} onChange={setDisplay} options={['English', 'Deutsch', 'Français']} /></Field>
      </div>
    </Card>
  )
}

function KidsCard() {
  const [on, setOn] = useState(settings.kidsRule.on)
  const [th, setTh] = useState(String(settings.kidsRule.threshold) as '0' | '6' | '12')
  return (
    <Card id="kids" title="Kids rule" description="When adding a Title rated at or below the threshold, preselect the Kids Profile for its HD Version." footer="Applies to new Titles and Requests only; existing Versions keep their Profile.">
      <div className="flex flex-wrap items-center gap-6">
        <Toggle on={on} onChange={setOn} label="Preselect Kids for young ratings" />
        <div className={cx('flex items-center gap-3', !on && 'pointer-events-none opacity-50')}>
          <span className="text-[13px] text-gray-900">Rated at or below</span>
          <Segmented value={th} onChange={setTh} options={(['0', '6', '12'] as const).map((v) => ({ value: v, label: `FSK ${v}` }))} />
        </div>
      </div>
    </Card>
  )
}

function ProfilesCard() {
  const [list, setList] = useState<Profile[]>(() => structuredClone(mockProfiles))
  const set = (id: string, fn: (p: Profile) => Profile) => setList((l) => l.map((p) => (p.id === id ? fn(p) : p)))
  const setDefault = (p: Profile, kind: Kind, on: boolean) =>
    setList((l) => l.map((x) => (x.slot !== p.slot ? x : { ...x, defaultFor: x.id === p.id ? (on ? [...x.defaultFor, kind] : x.defaultFor.filter((k) => k !== kind)) : on ? x.defaultFor.filter((k) => k !== kind) : x.defaultFor })))
  return (
    <Card id="profiles" title="Profiles" description="Each Profile belongs to one Slot and is backed by a TRaSH profile. A Slot has at most one default Profile for new Movies and one for new Series." footer="New Titles get an HD Version under the HD default; SD and UHD stay opt-in.">
      <div className="space-y-6">
        {SLOTS.map((slot) => (
          <div key={slot}>
            <div className="mb-2 flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{slot}</span>
              <span className="text-[12px] text-gray-900">{list.find((p) => p.slot === slot)?.resolution}</span>
            </div>
            <div className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
              {list.filter((p) => p.slot === slot).map((p) => (
                <div key={p.id} className={cx('flex items-center gap-x-5 px-4 py-3', !p.enabled && 'bg-background-200')}>
                  <span title={p.enabled ? 'Enabled' : 'Disabled'}>
                    <Toggle on={p.enabled} onChange={(v) => set(p.id, (x) => ({ ...x, enabled: v, defaultFor: v ? x.defaultFor : [] }))} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cx('text-sm font-medium', !p.enabled && 'text-gray-900')}>{p.name}</span>
                      <Badge tone={p.requires === 'primary' ? 'blue' : 'gray'}>{p.requires === 'primary' ? 'German' : 'Original Language'}</Badge>
                      {p.kids && <Badge tone="purple">Kids</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-gray-900">TRaSH: <span className="font-mono">{p.backing}</span> · {p.resolution}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[13px]">
                    <span className="text-gray-900">Default for</span>
                    <Checkbox checked={p.defaultFor.includes('movie')} disabled={!p.enabled} onChange={(on) => setDefault(p, 'movie', on)} label="Movies" />
                    <Checkbox checked={p.defaultFor.includes('series')} disabled={!p.enabled} onChange={(on) => setDefault(p, 'series', on)} label="Series" />
                  </div>
                  <div className="w-[150px] shrink-0">
                    {p.requires === 'primary' && (
                      <Toggle on={!!p.englishFallback} onChange={(v) => set(p.id, (x) => ({ ...x, englishFallback: v }))} label={<span className="text-[13px] whitespace-nowrap text-gray-900">English fallback</span>} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function TrashCard() {
  const { toast } = useStore()
  const [snapshot, setSnapshot] = useState(settings.trash.snapshot)
  const [busy, setBusy] = useState(false)
  const behind = snapshot !== settings.trash.latest
  return (
    <Card id="trash" title="TRaSH data" description="Custom formats, scores and quality ranges come from a pinned snapshot of the TRaSH Guides. Updating re-scores existing files; nothing is re-downloaded unless it becomes an Upgrade." footer={<a className="inline-flex items-center gap-1 hover:text-gray-1000" href="https://trash-guides.info" target="_blank" rel="noreferrer">trash-guides.info <ExternalLink size={12} /></a>}>
      <div className="flex flex-wrap items-center gap-6">
        <div>
          <div className="text-[12px] text-gray-900">Snapshot in use</div>
          <div className="tabular font-mono text-sm">{snapshot}</div>
        </div>
        <div>
          <div className="text-[12px] text-gray-900">Latest upstream</div>
          <div className="tabular font-mono text-sm">{settings.trash.latest}</div>
        </div>
        {behind ? <Badge tone="amber">Update available · 4 custom formats, 2 scores changed</Badge> : <Badge tone="green">Up to date</Badge>}
        <Button
          size="sm"
          className="ml-auto"
          disabled={!behind || busy}
          prefix={<RefreshCw size={13} className={cx(busy && 'animate-spin')} />}
          onClick={() => {
            setBusy(true)
            setTimeout(() => (setSnapshot(settings.trash.latest), setBusy(false), toast('Updated from TRaSH · 214 files re-scored, 3 Upgrades wanted')), 900)
          }}
        >
          Update from TRaSH
        </Button>
      </div>
    </Card>
  )
}

function IndexersCard() {
  const { toast } = useStore()
  return (
    <Card id="indexers" title="Indexers" description="Newznab indexers Kestrel searches. Limits are read from each indexer’s caps; Kestrel pauses one when it answers HTTP 429." footer={<Button size="sm" prefix={<Plus size={13} />}>Add indexer</Button>}>
      <div className="divide-y divide-gray-alpha-400 rounded-lg border border-gray-alpha-400">
        {settings.indexers.map((i) => (
          <div key={i.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Dot tone={i.status === 'ok' ? 'green' : 'amber'} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {i.name}
                {i.idSearch ? <Badge>ID search</Badge> : <Badge tone="amber">Text search only</Badge>}
              </div>
              <div className="truncate font-mono text-[12px] text-gray-900">{i.url}</div>
            </div>
            <div className="tabular text-right text-[12px] text-gray-900">
              <div>{i.used}</div>
              <div>{i.limit}</div>
            </div>
            {i.status === 'paused' && <Badge tone="amber">{i.pausedUntil}</Badge>}
            <Button size="sm" onClick={() => toast(`${i.name}: connected · caps read`)}>Test</Button>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SabCard() {
  const { toast } = useStore()
  return (
    <Card id="sabnzbd" title="SABnzbd" description="The download client every Grab is handed to." footer={<span className="flex items-center gap-2"><Dot tone="green" /> {settings.sabnzbd.status} · {settings.sabnzbd.free}</span>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="URL"><Input className="font-mono" defaultValue={settings.sabnzbd.url} /></Field>
        <Field label="API key"><Input className="font-mono" type="password" defaultValue="0123456789abcdef" /></Field>
        <Field label="Category"><Input className="font-mono" defaultValue={settings.sabnzbd.category} /></Field>
        <div className="flex items-end"><Button onClick={() => toast('SABnzbd: connected · v4.5.3')}>Test connection</Button></div>
      </div>
    </Card>
  )
}

function FoldersCard() {
  return (
    <Card id="folders" title="Media folders" description="Where Titles live, and where SABnzbd puts completed downloads. Keep both under one /data mount so Import is an instant move." footer="TRaSH /data layout">
      <div className="grid gap-4 sm:grid-cols-2">
        {settings.rootFolders.map((f) => (
          <Field key={f.kind} label={`${f.kind === 'movie' ? 'Movies' : 'Series'} root folder`} hint={`${f.free} free`}>
            <Input className="font-mono" defaultValue={f.path} />
          </Field>
        ))}
        <Field label="Movies downloads"><Input className="font-mono" defaultValue={settings.downloadFolders.movie} /></Field>
        <Field label="Series downloads"><Input className="font-mono" defaultValue={settings.downloadFolders.series} /></Field>
      </div>
      <pre className="mt-5 rounded-lg border border-gray-alpha-400 bg-background-200 p-4 font-mono text-[12px] leading-relaxed text-gray-900">{`/data
├── usenet
│   ├── movies
│   └── tv
└── media
    ├── movies
    └── tv`}</pre>
    </Card>
  )
}

function MetadataCard() {
  return (
    <Card id="metadata" title="Metadata provider keys" description="Kestrel ships with its own TMDB and TheTVDB keys. Add your own to override them." footer={`Last metadata refresh ${settings.metadata.lastRefresh}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="TMDB API key" hint="Using the embedded key"><Input className="font-mono" placeholder="Embedded key" /></Field>
        <Field label="TheTVDB API key" hint="Using the embedded key"><Input className="font-mono" placeholder="Embedded key" /></Field>
      </div>
    </Card>
  )
}

function ApiKeyCard() {
  const { toast } = useStore()
  const [key, setKey] = useState(settings.apiKey)
  return (
    <Card id="api" title="API key" description="Used by Silo and other tools to send Requests and read the library." footer="Regenerating disconnects every tool using the old key.">
      <div className="flex items-center gap-2">
        <div className="flex h-9 flex-1 items-center rounded-md border border-gray-alpha-400 bg-background-200 px-3 font-mono text-[13px]">{key}</div>
        <Button prefix={<Copy size={13} />} onClick={() => toast('API key copied')}>Copy</Button>
        <Button onClick={() => (setKey('kst_9a03be71••••••••••••41fc'), toast('New API key generated'))}>Regenerate</Button>
      </div>
    </Card>
  )
}
