import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { DestinationService } from './destinations.js'
import type { ReachabilityQuery, ReachabilityService } from './reachability.js'
import { isValidDateTime, todayIn, zonedTimeToUtc } from './time.js'
import { UpstreamError } from './transit/types.js'
import { APP_VERSION } from './version.js'

/**
 * Every API response is JSON.
 * Success: `{ "ok": true, ...payload }`.
 * Failure: `{ "ok": false, "error": { "code": "<machine_code>", "message": "<for logs>" } }`.
 */
export type ApiError = { ok: false; error: { code: string; message: string } }

const apiError = (code: string, message: string): ApiError => ({ ok: false, error: { code, message } })

/** Production site and the Vite dev server. Override with CORS_ORIGINS (comma-separated). */
export const DEFAULT_CORS_ORIGINS = ['https://wander-buddy.zebaro.dev', 'http://localhost:5173']

export const MAX_MINUTES = { min: 15, max: 180, default: 120 }

export function createApp(
  options: { corsOrigins?: string[]; reachability?: ReachabilityService; destinations?: DestinationService } = {},
) {
  const app = new Hono()

  // The site normally reaches the API through its own origin (nginx proxies /api), so CORS only
  // matters for direct calls to the API from an allowed origin.
  app.use('/api/*', cors({ origin: options.corsOrigins ?? DEFAULT_CORS_ORIGINS, exposeHeaders: ['x-cache'] }))

  const api = new Hono()
  api.get('/health', (c) => c.json({ ok: true, version: APP_VERSION }))

  const reach = options.reachability
  if (reach) {
    // Station search for the origin field: GET /api/stations?q=Fulda
    api.get('/stations', async (c) => {
      const q = (c.req.query('q') ?? '').trim()
      if (q.length < 2) return c.json(apiError('bad_request', 'q must have at least 2 characters'), 400)
      return c.json({ ok: true, stations: await reach.findStations(q, 5) })
    })

    /**
     * The search both endpoints share:
     * from=Fulda | lat=..&lon=..  [&date=YYYY-MM-DD&time=HH:MM (Europe/Berlin, default today 09:00)]
     * [&maxMinutes=15..180, default 120] [&villages=true]
     */
    const parseSearch = async (
      q: Record<string, string>,
    ): Promise<{ query: ReachabilityQuery; villages: boolean } | { error: ApiError; status: 400 | 404 }> => {
      const bad = (message: string) => ({ error: apiError('bad_request', message), status: 400 as const })
      const maxMinutes = q.maxMinutes === undefined ? MAX_MINUTES.default : Number(q.maxMinutes)
      if (!Number.isInteger(maxMinutes) || maxMinutes < MAX_MINUTES.min || maxMinutes > MAX_MINUTES.max) {
        return bad(`maxMinutes must be an integer ${MAX_MINUTES.min}-${MAX_MINUTES.max}`)
      }
      const date = q.date ?? todayIn()
      const time = q.time ?? '09:00'
      if (!isValidDateTime(date, time)) return bad('date must be a real YYYY-MM-DD and time HH:MM')

      let origin
      if (q.lat !== undefined || q.lon !== undefined) {
        const lat = Number(q.lat)
        const lon = Number(q.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return bad('lat and lon must be valid coordinates')
        }
        origin = { id: `${lat},${lon}`, name: '', lat, lon }
      } else if (q.from?.trim()) {
        origin = await reach.findOrigin(q.from)
        if (!origin) return { error: apiError('origin_not_found', `No station matches "${q.from}"`), status: 404 }
      } else {
        return bad('Give from=<place> or lat and lon')
      }
      return { query: { origin, departure: zonedTimeToUtc(date, time), maxMinutes }, villages: q.villages === 'true' }
    }

    // Towns reachable by regional transport: GET /api/reachable?<search>
    api.get('/reachable', async (c) => {
      const parsed = await parseSearch(c.req.query())
      if ('error' in parsed) return c.json(parsed.error, parsed.status)
      const { result, cached } = await reach.reachable(parsed.query)
      c.header('x-cache', cached ? 'HIT' : 'MISS')
      const cities = parsed.villages ? result.cities : result.cities.filter((city) => city.kind !== 'village')
      return c.json({ ok: true, provider: reach.providerName, ...result, cities })
    })

    // The same towns with the weather on the day and places to see: GET /api/destinations?<search>
    const dest = options.destinations
    if (dest) {
      api.get('/destinations', async (c) => {
        const parsed = await parseSearch(c.req.query())
        if ('error' in parsed) return c.json(parsed.error, parsed.status)
        const { result, cached } = await dest.destinations(parsed.query, { villages: parsed.villages })
        c.header('x-cache', cached ? 'HIT' : 'MISS')
        return c.json({ ok: true, provider: reach.providerName, ...result })
      })
    }
  }

  api.all('*', (c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.route('/api', api)

  app.notFound((c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.onError((err, c) => {
    if (err instanceof UpstreamError) {
      console.warn(err.message)
      return c.json(apiError('upstream_unavailable', 'A data source did not answer'), 502)
    }
    console.error(err)
    return c.json(apiError('internal', 'Internal server error'), 500)
  })

  return app
}
