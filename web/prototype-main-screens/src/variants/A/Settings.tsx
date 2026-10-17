// PROTOTYPE, throwaway. Variant A Settings: secondary left nav, one section per page.
import { useState } from 'react'
import { Copy, Database, Download, Folder, Globe, KeyRound, Layers, Plus, RefreshCw, Rss, Shield, Wand2 } from 'lucide-react'
import { SLOTS, type Kind } from '../../mock'
import { go, navigate, useParam } from '../../nav'
import { Badge, Dot, Select, Toggle, cx } from '../../ui'
import { Button, Card, Dialog, Field, Input, Page, PageHeader, Segmented, Table, td, th } from './shell'
import { useStore } from './store'

const SECTIONS = [
  { key: 'general', label: 'General', icon: Globe },
  { key: 'profiles', label: 'Profiles', icon: Layers },
  { key: 'indexers', label: 'Indexers', icon: Rss },
  { key: 'download', label: 'Download client', icon: Download },
  { key: 'folders', label: 'Media folders', icon: Folder },
  { key: 'metadata', label: 'Metadata', icon: Database },
  { key: 'security', label: 'Security', icon: Shield },
]

export function SettingsScreen() {
  const section = useParam('section', 'general')
  const current = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]
  return (
    <>
      <PageHeader
        title="Settings"
        crumbs={[{ label: 'Settings', onClick: () => go('settings') }, { label: current.label }]}
        actions={
          <Button size="sm" prefix={<Wand2 className="size-3.5" />} onClick={() => go('wizard')}>
            Run setup again
          </Button>
        }
      />
      <Page>
        <div className="flex gap-8">
          <nav className="flex w-48 shrink-0 flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => navigate({ section: s.key }, true)}
                className={cx(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px]',
                  current.key === s.key ? 'bg-gray-alpha-200 font-medium text-gray-1000' : 'text-gray-900 hover:bg-gray-alpha-100 hover:text-gray-1000',
                )}
              >
                <s.icon className="size-4" strokeWidth={1.75} />
                {s.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1">
            {current.key === 'general' && <General />}
            {current.key === 'profiles' && <Profiles />}
            {current.key === 'indexers' && <Indexers />}
            {current.key === 'download' && <DownloadClient />}
            {current.key === 'folders' && <Folders />}
            {current.key === 'metadata' && <Metadata />}
            {current.key === 'security' && <Security />}
          </div>
        </div>
      </Page>
    </>
  )
}

const ratingLabel = (country: string, n: number) => (country === 'DE' || country === 'AT' ? `FSK ${n}` : country === 'FR' ? (n === 0 ? 'Tous publics' : `-${n === 6 ? 10 : 12}`) : n === 0 ? 'G' : n === 6 ? 'PG' : 'PG-13')

function General() {
  const { settings, setSettings, notify } = useStore()
  const set = (patch: Partial<typeof settings>) => setSettings({ ...settings, ...patch })
  return (
    <div className="flex flex-col gap-4">
      <Card title="Language and region" footer={<><span>Changing the Primary Language rescores every Version.</span><Button size="sm" variant="primary" onClick={() => notify('Settings saved')}>Save</Button></>}>
        <div className="-my-3 divide-y divide-gray-alpha-400">
          <Field label="Primary Language" hint="The household’s own language. Profiles require it unless they require the Original Language.">
            <Select className="w-56" value={settings.primaryLanguage} options={['English', 'German', 'French']} onChange={(v) => set({ primaryLanguage: v })} />
          </Field>
          <Field label="Release-date country" hint="Which country’s release dates and age ratings Kestrel uses.">
            <Select className="w-56" value={settings.releaseCountry} options={['DE', 'AT', 'CH', 'US', 'GB', 'FR']} onChange={(v) => set({ releaseCountry: v })} />
          </Field>
          <Field label="Display language" hint="Language of this interface.">
            <Select className="w-56" value={settings.displayLanguage} options={['English', 'Deutsch', 'Français']} onChange={(v) => set({ displayLanguage: v })} />
          </Field>
        </div>
      </Card>
      <Card title="Kids rule" description="New Titles rated at or below the threshold get the Kids Profile in the HD Slot instead of the default.">
        <div className="flex items-center gap-6">
          <Toggle on={settings.kidsRule.on} onChange={(on) => set({ kidsRule: { ...settings.kidsRule, on } })} label="Use the Kids Profile for young audiences" />
          <div className={cx('flex items-center gap-2', !settings.kidsRule.on && 'pointer-events-none opacity-50')}>
            <span className="text-[13px] text-gray-900">Up to</span>
            <Segmented
              size="sm"
              value={String(settings.kidsRule.threshold)}
              onChange={(v) => set({ kidsRule: { ...settings.kidsRule, threshold: Number(v) as 0 | 6 | 12 } })}
              options={['0', '6', '12'].map((n) => ({ key: n, label: ratingLabel(settings.releaseCountry, Number(n)) }))}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

function Profiles() {
  const { profiles, setProfiles, settings, setSettings, notify } = useStore()
  const upToDate = settings.trash.snapshot === settings.trash.latest
  const setDefault = (id: string, kind: Kind) =>
    setProfiles((ps) => {
      const p = ps.find((x) => x.id === id)!
      const was = p.defaultFor.includes(kind)
      if (was && p.slot === 'HD') return ps // HD always has a default
      return ps.map((x) => (x.slot !== p.slot ? x : { ...x, defaultFor: x.id === id && !was ? [...x.defaultFor.filter((k) => k !== kind), kind] : x.defaultFor.filter((k) => k !== kind) }))
    })
  const patch = (id: string, fn: (p: (typeof profiles)[number]) => Partial<(typeof profiles)[number]>) => setProfiles((ps) => ps.map((p) => (p.id === id ? { ...p, ...fn(p) } : p)))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 rounded-lg border border-gray-alpha-400 bg-background-100 px-5 py-4">
        <div className="flex-1">
          <div className="text-[13px] font-medium">TRaSH Guides</div>
          <div className="tabular mt-0.5 text-[12px] text-gray-900">
            Snapshot <span className="font-mono text-gray-1000">{settings.trash.snapshot}</span> · latest <span className="font-mono text-gray-1000">{settings.trash.latest}</span>
            {upToDate ? ' · up to date' : ' · custom formats and scores changed upstream'}
          </div>
        </div>
        {upToDate ? (
          <Badge tone="green">Up to date</Badge>
        ) : (
          <Button
            size="sm"
            variant="primary"
            prefix={<RefreshCw className="size-3.5" />}
            onClick={() => {
              setSettings({ ...settings, trash: { ...settings.trash, snapshot: settings.trash.latest } })
              notify('Updated from TRaSH · 4 custom formats changed · Versions rescored')
            }}
          >
            Update from TRaSH
          </Button>
        )}
      </div>
      {SLOTS.map((slot) => (
        <div key={slot}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="font-mono text-[13px] font-semibold">{slot}</h3>
            <span className="text-[12px] text-gray-900">{slot === 'HD' ? 'Standard Slot, default for new Titles' : 'Opt-in Slot'}</span>
          </div>
          <Table
            head={
              <>
                <th className={th}>Profile</th>
                <th className={th}>Requires</th>
                <th className={th}>Resolution</th>
                <th className={th}>TRaSH backing</th>
                <th className={cx(th, 'text-center')}>Default · Movies</th>
                <th className={cx(th, 'text-center')}>Default · Series</th>
                <th className={th}>English fallback</th>
                <th className={th}>Enabled</th>
              </>
            }
          >
            {profiles
              .filter((p) => p.slot === slot)
              .map((p) => (
                <tr key={p.id} className={cx('hover:bg-gray-alpha-100', !p.enabled && 'opacity-50')}>
                  <td className={cx(td, 'whitespace-nowrap font-medium')}>
                    {p.name} {p.kids && <Badge tone="amber">Kids</Badge>}
                  </td>
                  <td className={cx(td, 'whitespace-nowrap text-gray-900')}>{p.requires === 'primary' ? `Primary Language (${settings.primaryLanguage})` : 'Original Language'}</td>
                  <td className={cx(td, 'whitespace-nowrap text-gray-900')}>{p.resolution}</td>
                  <td className={cx(td, 'text-[12px] text-gray-900')}>{p.backing}</td>
                  {(['movie', 'series'] as Kind[]).map((k) => (
                    <td key={k} className={cx(td, 'text-center')}>
                      <input type="radio" disabled={!p.enabled} checked={p.defaultFor.includes(k)} onClick={() => setDefault(p.id, k)} onChange={() => {}} className="size-4 accent-[var(--ds-gray-1000)]" />
                    </td>
                  ))}
                  <td className={td}>{p.requires === 'primary' ? <Toggle on={!!p.englishFallback} onChange={(v) => patch(p.id, () => ({ englishFallback: v }))} /> : <span className="text-gray-700">—</span>}</td>
                  <td className={td}>
                    <Toggle on={p.enabled} onChange={(v) => patch(p.id, () => ({ enabled: v, defaultFor: v ? p.defaultFor : [] }))} />
                  </td>
                </tr>
              ))}
          </Table>
        </div>
      ))}
      <p className="text-[12px] text-gray-900">
        English fallback lets a Primary-Language Profile accept an English-only Release when no German one exists. Click a selected default again to clear it (SD and UHD only).
      </p>
    </div>
  )
}

function Indexers() {
  const { settings, notify } = useStore()
  return (
    <Card
      title="Indexers"
      description="Newznab indexers Kestrel searches. Rate limits are respected per indexer."
      actions={
        <Button size="sm" variant="primary" prefix={<Plus className="size-3.5" />} onClick={() => notify('Add indexer (not in prototype)')}>
          Add indexer
        </Button>
      }
    >
      <Table
        head={
          <>
            <th className={th}>Status</th>
            <th className={th}>Name</th>
            <th className={th}>URL</th>
            <th className={th}>API limit</th>
            <th className={th}>Used</th>
            <th className={th}>ID search</th>
            <th className={th} />
          </>
        }
      >
        {settings.indexers.map((i) => (
          <tr key={i.name} className="hover:bg-gray-alpha-100">
            <td className={cx(td, 'whitespace-nowrap')}>
              <span className="inline-flex items-center gap-1.5">
                <Dot tone={i.status === 'ok' ? 'green' : 'amber'} />
                {i.status === 'ok' ? 'Healthy' : 'Paused'}
              </span>
              {'pausedUntil' in i && i.pausedUntil && <div className="text-[11px] text-amber-900">{i.pausedUntil}</div>}
            </td>
            <td className={cx(td, 'font-medium')}>{i.name}</td>
            <td className={cx(td, 'font-mono text-[12px] text-gray-900')}>{i.url}</td>
            <td className={cx(td, 'tabular text-gray-900')}>{i.limit}</td>
            <td className={cx(td, 'tabular text-gray-900')}>{i.used}</td>
            <td className={td}>{i.idSearch ? <Badge tone="green">TMDB/TVDB IDs</Badge> : <Badge>Title only</Badge>}</td>
            <td className={cx(td, 'text-right')}>
              <Button size="sm" variant="tertiary" onClick={() => notify(`${i.name}: test OK · 212 ms`)}>
                Test
              </Button>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  )
}

function DownloadClient() {
  const { settings, notify } = useStore()
  return (
    <Card
      title="SABnzbd"
      description="Kestrel’s only download client."
      actions={
        <span className="inline-flex items-center gap-1.5 text-[13px]">
          <Dot tone="green" /> {settings.sabnzbd.status}
        </span>
      }
      footer={
        <>
          <span>{settings.sabnzbd.free}</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => notify('SABnzbd: connected · v4.5.3')}>
              Test connection
            </Button>
            <Button size="sm" variant="primary" onClick={() => notify('Saved')}>
              Save
            </Button>
          </div>
        </>
      }
    >
      <div className="-my-3 divide-y divide-gray-alpha-400">
        <Field label="URL">
          <Input className="font-mono text-[13px]" defaultValue={settings.sabnzbd.url} />
        </Field>
        <Field label="API key">
          <Input className="font-mono text-[13px]" type="password" defaultValue="0123456789abcdef0123456789abcdef" />
        </Field>
        <Field label="Category" hint="Kestrel only looks at jobs in this category.">
          <Input className="w-56 font-mono text-[13px]" defaultValue={settings.sabnzbd.category} />
        </Field>
      </div>
    </Card>
  )
}

function Folders() {
  const { settings } = useStore()
  return (
    <div className="flex flex-col gap-4">
      <Card title="Root folders" description="Where Titles live. Each Title gets one folder; all its Versions sit side by side in it.">
        <Table
          head={
            <>
              <th className={th}>Kind</th>
              <th className={th}>Path</th>
              <th className={cx(th, 'text-right')}>Free</th>
              <th className={th} />
            </>
          }
        >
          {settings.rootFolders.map((f) => (
            <tr key={f.path}>
              <td className={td}>{f.kind === 'movie' ? 'Movies' : 'Series'}</td>
              <td className={cx(td, 'font-mono text-[12px]')}>{f.path}</td>
              <td className={cx(td, 'tabular text-right text-gray-900')}>{f.free}</td>
              <td className={cx(td, 'text-right')}>
                <Button size="sm" variant="tertiary">
                  Scan for Adoption
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Download folders" description="Where SABnzbd puts finished jobs before Import. Must be visible to Kestrel at the same path.">
        <div className="-my-3 divide-y divide-gray-alpha-400">
          <Field label="Movies">
            <Input className="font-mono text-[13px]" defaultValue={settings.downloadFolders.movie} />
          </Field>
          <Field label="Series">
            <Input className="font-mono text-[13px]" defaultValue={settings.downloadFolders.series} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

function Metadata() {
  const { settings, notify } = useStore()
  return (
    <Card
      title="Metadata providers"
      description="Kestrel ships with its own TMDB and TheTVDB keys. Override them only if you have your own."
      footer={
        <>
          <span className="tabular">Last refresh {settings.metadata.lastRefresh}</span>
          <Button size="sm" prefix={<RefreshCw className="size-3.5" />} onClick={() => notify('Refreshing metadata for all Titles')}>
            Refresh now
          </Button>
        </>
      }
    >
      <div className="-my-3 divide-y divide-gray-alpha-400">
        <Field label="TMDB API key" hint="Movies, Series search, posters, release dates.">
          <Input className="font-mono text-[13px]" placeholder="Using Kestrel’s embedded key" />
        </Field>
        <Field label="TheTVDB API key" hint="Seasons, episodes and air dates.">
          <Input className="font-mono text-[13px]" placeholder="Using Kestrel’s embedded key" />
        </Field>
        <Field label="TheTVDB subscriber PIN" hint="Optional.">
          <Input className="w-56 font-mono text-[13px]" placeholder="—" />
        </Field>
      </div>
    </Card>
  )
}

function Security() {
  const { settings, setSettings, notify } = useStore()
  const [confirm, setConfirm] = useState(false)
  return (
    <Card title="API key" description="Used by Silo and other clients to send Requests and read the library.">
      <div className="flex items-center gap-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-md border border-gray-alpha-400 bg-background-200 px-3 font-mono text-[13px]">
          <KeyRound className="size-4 text-gray-900" />
          {settings.apiKey}
        </div>
        <Button prefix={<Copy className="size-4" />} onClick={() => notify('API key copied')}>
          Copy
        </Button>
        <Button prefix={<RefreshCw className="size-4" />} onClick={() => setConfirm(true)}>
          Regenerate
        </Button>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Regenerate the API key?"
        footer={
          <>
            <Button size="sm" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="error"
              onClick={() => {
                setSettings({ ...settings, apiKey: `kst_${Math.random().toString(16).slice(2, 10)}••••••••••••${Math.random().toString(16).slice(2, 6)}` })
                setConfirm(false)
                notify('New API key generated · update it in Silo')
              }}
            >
              Regenerate
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-gray-900">The current key stops working at once. Silo can’t send Requests until you paste the new key there.</p>
      </Dialog>
    </Card>
  )
}
