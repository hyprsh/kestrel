// About: version, licence, the update the daily GitHub check found, metadata attribution,
// the TRaSH commit scoring Releases now, third-party notices and keyboard shortcuts.
import { useState, type ReactNode } from 'react'
import { useAbout, useNotices } from '../api/about'
import { MOD } from '../keys'
import { Kbd } from '../ui'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-gray-alpha-400 bg-background-100 p-4">
      <h2 className="mb-2 text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

const shortcuts: [string[], string][] = [
  [[MOD, 'K'], 'Open the command menu: jump to a Title or screen, add a Title, run an action'],
  [['J', 'K'], 'Move down and up in a list (arrow keys work too)'],
  [['Enter'], 'Open the selected row'],
  [['X'], 'Tick the Title under the cursor in the Library, to change several at once (Shift-click ticks a range)'],
  [['Esc'], 'Close the menu, go back or clear the ticked Titles'],
]

export function About() {
  const about = useAbout()
  const [showNotices, setShowNotices] = useState(false)
  const notices = useNotices(showNotices)
  const a = about.data

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Card title="Kestrel">
          {a ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5">
              <dt className="text-gray-900">Version</dt>
              <dd className="font-mono">{a.version}</dd>
              <dt className="text-gray-900">Licence</dt>
              <dd>{a.license} (GNU General Public License v3.0)</dd>
              <dt className="text-gray-900">TRaSH commit</dt>
              <dd className="font-mono" title="The TRaSH Guides commit whose Custom Formats and profiles score Releases now">
                {a.trash_commit ? a.trash_commit.slice(0, 7) : 'unknown'}
              </dd>
              <dt className="text-gray-900">Updates</dt>
              <dd>
                {a.update ? (
                  <a className="text-blue-900 underline" href={a.update.url} target="_blank" rel="noreferrer">
                    Kestrel {a.update.version} available
                  </a>
                ) : a.check_github_updates ? (
                  'Up to date'
                ) : (
                  'The check is off (Settings, Updates)'
                )}
              </dd>
            </dl>
          ) : (
            <p className="text-gray-900">Loading…</p>
          )}
        </Card>

        <Card title="Attribution">
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          <p className="mt-2">
            Metadata provided by TheTVDB. Please consider adding missing information or{' '}
            <a className="text-blue-900 underline" href="https://thetvdb.com" target="_blank" rel="noreferrer">
              subscribing
            </a>
            .
          </p>
          <p className="mt-2 text-gray-900">
            Custom Formats and quality profiles come from the{' '}
            <a className="text-blue-900 underline" href="https://github.com/TRaSH-Guides/Guides" target="_blank" rel="noreferrer">
              TRaSH Guides
            </a>
            . Release parsing is ported from Radarr and Sonarr.
          </p>
        </Card>

        <Card title="Keyboard shortcuts">
          <ul className="flex flex-col gap-1.5">
            {shortcuts.map(([keys, what]) => (
              <li key={what} className="flex items-center gap-3">
                <span className="flex w-24 shrink-0 gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
                <span>{what}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Third-party notices">
          <p className="mb-2 text-gray-900">The ported Radarr and Sonarr code, TRaSH data and every dependency, with their licences.</p>
          {showNotices ? (
            notices.data !== undefined ? (
              <pre aria-label="Notices text" className="max-h-96 overflow-auto rounded-md bg-background-200 p-3 font-mono text-[11px] whitespace-pre-wrap">
                {notices.data}
              </pre>
            ) : (
              <p className="text-gray-900">{notices.isError ? 'Could not load the notices.' : 'Loading…'}</p>
            )
          ) : (
            <button type="button" className="text-blue-900 underline" onClick={() => setShowNotices(true)}>
              Show notices
            </button>
          )}
        </Card>
      </div>
    </div>
  )
}
