import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ReachabilityService } from './reachability.js'
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

export function createApp(options: { corsOrigins?: string[]; reachability?: ReachabilityService } = {}) {
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

    // Towns reachable by regional transport:
    // GET /api/reachable?from=Fulda | lat=..&lon=..  [&date=YYYY-MM-DD&time=HH:MM (Europe/Berlin)]
    //     [&maxMinutes=15..180] [&villages=true]
    api.get('/reachable', async (c) => {
      const q = c.req.query()
      const maxMinutes = q.maxMinutes === undefined ? MAX_MINUTES.default : Number(q.maxMinutes)
      if (!Number.isInteger(maxMinutes) || maxMinutes < MAX_MINUTES.min || maxMinutes > MAX_MINUTES.max) {
        return c.json(apiError('bad_request', `maxMinutes must be an integer ${MAX_MINUTES.min}-${MAX_MINUTES.max}`), 400)
      }
      const date = q.date ?? todayIn()
      const time = q.time ?? '09:00'
      if (!isValidDateTime(date, time)) {
        return c.json(apiError('bad_request', 'date must be a real YYYY-MM-DD and time HH:MM'), 400)
      }

      let origin
      if (q.lat !== undefined || q.lon !== undefined) {
        const lat = Number(q.lat)
        const lon = Number(q.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return c.json(apiError('bad_request', 'lat and lon must be valid coordinates'), 400)
        }
        origin = { id: `${lat},${lon}`, name: '', lat, lon }
      } else if (q.from?.trim()) {
        origin = await reach.findOrigin(q.from)
        if (!origin) return c.json(apiError('origin_not_found', `No station matches "${q.from}"`), 404)
      } else {
        return c.json(apiError('bad_request', 'Give from=<place> or lat and lon'), 400)
      }

      const { result, cached } = await reach.reachable({ origin, departure: zonedTimeToUtc(date, time), maxMinutes })
      c.header('x-cache', cached ? 'HIT' : 'MISS')
      const villages = q.villages === 'true'
      const cities = villages ? result.cities : result.cities.filter((city) => city.kind !== 'village')
      return c.json({ ok: true, provider: reach.providerName, ...result, cities })
    })
  }

  api.all('*', (c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.route('/api', api)

  app.notFound((c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.onError((err, c) => {
    if (err instanceof UpstreamError) {
      console.warn(err.message)
      return c.json(apiError('upstream_unavailable', 'A transport data source did not answer'), 502)
    }
    console.error(err)
    return c.json(apiError('internal', 'Internal server error'), 500)
  })

  return app
}
