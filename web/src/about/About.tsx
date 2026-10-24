// About: version, licence, the update the daily GitHub check found, metadata attribution,
// the TRaSH commit scoring Releases now, third-party notices and keyboard shortcuts.
import { useState, type ReactNode } from 'react'
import { useAbout, useNotices } from '../api/about'
import { Button, Code, Description, Fieldset, KeyboardInput, Link } from '@hyprsh/design'
import { LoadingLine } from '../layout/LoadingLine'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <Fieldset>
        <Fieldset.Content>
          <Fieldset.Title as="h2">{title}</Fieldset.Title>
          <div className="copy-14 pt-3">{children}</div>
        </Fieldset.Content>
      </Fieldset>
    </section>
  )
}

// `meta` is the platform's command key (⌘ or Ctrl) held with the one key.
const shortcuts: [{ meta?: boolean; keys: string[] }, string][] = [
  [{ meta: true, keys: ['K'] }, 'Open the command menu: jump to a Title or screen, add a Title, run an action'],
  [{ keys: ['J', 'K'] }, 'Move down and up in a list (arrow keys work too)'],
  [{ keys: ['Enter'] }, 'Open the selected row'],
  [{ keys: ['X'] }, 'Tick the Title under the cursor in the Library, to change several at once (Shift-click ticks a range)'],
  [{ keys: ['Esc'] }, 'Close the menu, go back or clear the ticked Titles'],
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
            <div className="flex flex-col gap-1.5">
              <Description layout="horizontal" termWidth="9.25rem" title="Version" content={<span className="copy-14-mono">{a.version}</span>} />
              <Description layout="horizontal" termWidth="9.25rem" title="Licence" content={`${a.license} (GNU General Public License v3.0)`} />
              <Description
                layout="horizontal"
                termWidth="9.25rem"
                title="TRaSH commit"
                content={
                  <span className="copy-14-mono" title="The TRaSH Guides commit whose Custom Formats and profiles score Releases now">
                    {a.trash_commit ? a.trash_commit.slice(0, 7) : 'unknown'}
                  </span>
                }
              />
              <Description
                layout="horizontal"
                termWidth="9.25rem"
                title="Updates"
                content={
                  a.update ? (
                    <Link href={a.update.url} target="_blank" rel="noreferrer">
                      Kestrel {a.update.version} available
                    </Link>
                  ) : a.check_github_updates ? (
                    'Up to date'
                  ) : (
                    'The check is off (Settings, Updates)'
                  )
                }
              />
            </div>
          ) : (
            <LoadingLine>Loading…</LoadingLine>
          )}
        </Card>

        <Card title="Attribution">
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          <p className="mt-2">
            Metadata provided by TheTVDB. Please consider adding missing information or{' '}
            <Link href="https://thetvdb.com" target="_blank" rel="noreferrer">
              subscribing
            </Link>
            .
          </p>
          <p className="mt-2 text-gray-900">
            Custom Formats and quality profiles come from the{' '}
            <Link href="https://github.com/TRaSH-Guides/Guides" target="_blank" rel="noreferrer">
              TRaSH Guides
            </Link>
            . Release parsing is ported from Radarr and Sonarr.
          </p>
        </Card>

        <Card title="Keyboard shortcuts">
          <div className="flex flex-col gap-1.5">
            {shortcuts.map(([keys, what]) => (
              <Description
                key={what}
                layout="horizontal"
                termWidth="6rem"
                title={
                  <span className="flex gap-1">
                    {keys.keys.map((k, i) => (
                      <KeyboardInput key={k} meta={keys.meta && i === 0}>
                        {k}
                      </KeyboardInput>
                    ))}
                  </span>
                }
                content={what}
              />
            ))}
          </div>
        </Card>

        <Card title="Third-party notices">
          <p className="mb-2 text-gray-900">The ported Radarr and Sonarr code, TRaSH data and every dependency, with their licences.</p>
          {showNotices ? (
            notices.data !== undefined ? (
              <Code block aria-label="Notices text">
                {notices.data}
              </Code>
            ) : notices.isError ? (
              <p className="text-gray-900">Could not load the notices.</p>
            ) : (
              <LoadingLine>Loading…</LoadingLine>
            )
          ) : (
            <Button size="small" onClick={() => setShowNotices(true)}>
              Show notices
            </Button>
          )}
        </Card>
      </div>
    </div>
  )
}
