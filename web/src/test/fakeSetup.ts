import { http } from './handlers'
import { server } from './server'

export type SectionKey = 'account' | 'language' | 'download_client' | 'indexer' | 'root_folders' | 'profiles'
export type SetupFake = { completed: boolean; sections: Record<SectionKey, 'done' | 'todo'>; finishCalls: number }

const names: Record<SectionKey, string> = {
  account: 'account',
  language: 'Primary Language',
  download_client: 'Download client',
  indexer: 'Indexer',
  root_folders: 'Root folders',
  profiles: 'Profiles',
}

/**
 * A stateful GET /setup and POST /setup/complete. Tests flip `sections` as the
 * wizard "saves"; finishing is refused with the missing list until all are done.
 */
export function fakeSetup(over: Partial<Record<SectionKey, 'done' | 'todo'>> = {}, completed = false): SetupFake {
  const state: SetupFake = {
    completed,
    finishCalls: 0,
    sections: { account: 'done', language: 'todo', download_client: 'todo', indexer: 'todo', root_folders: 'todo', profiles: 'todo', ...over },
  }
  server.use(
    http.get('/setup', ({ response }) =>
      response(200).json({ account_exists: true, completed: state.completed, sections: state.sections }),
    ),
    http.post('/setup/complete', ({ response }) => {
      state.finishCalls++
      const missing = (Object.keys(state.sections) as SectionKey[]).filter((k) => state.sections[k] !== 'done')
      if (missing.length > 0) {
        return response('default').json(
          {
            type: 'about:blank',
            title: 'unprocessable entity',
            status: 422,
            code: 'validation',
            detail: 'setup is not finished: some sections are missing',
            errors: missing.map((k) => ({ field: `sections.${k}`, code: 'todo', message: `${names[k]} is not set up yet` })),
          },
          { status: 422 },
        )
      }
      state.completed = true
      return response(204).empty()
    }),
  )
  return state
}
