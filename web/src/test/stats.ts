import { http } from './handlers'
import { server } from './server'
import { stats, type Stats } from './statsData'

/** GET /stats serving `make(range)`, and the ranges it was asked for. */
export function fakeStats(make: (range: Stats['range']) => Stats = () => stats()) {
  const asked: string[] = []
  server.use(
    http.get('/stats', ({ request, response }) => {
      const range = (new URL(request.url).searchParams.get('range') ?? '30d') as Stats['range']
      asked.push(range)
      return response(200).json(make(range))
    }),
  )
  return asked
}
