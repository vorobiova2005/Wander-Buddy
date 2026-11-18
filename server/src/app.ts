import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { DestinationService } from './destinations.js'
import type { ReachabilityQuery, ReachabilityService } from './reachability.js'
import type { VerdictService } from './verdict.js'
import { BusyError } from './cache.js'
import { addDays, isValidDateTime, todayIn, zonedTimeToUtc } from './time.js'
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

/** A trip day from yesterday (a search sent just before midnight) to 60 days ahead - as the date field offers. */
export const DATE_RANGE = { back: 1, ahead: 60 }

/** Longest station query: a name, not a text. */
export const MAX_QUERY_LENGTH = 100

export function createApp(
  options: {
    corsOrigins?: string[]
    reachability?: ReachabilityService
    destinations?: DestinationService
    verdicts?: VerdictService
    /** Today in Europe/Berlin (injectable for tests). */
    today?: () => string
  } = {},
) {
  const app = new Hono()

  // The site normally reaches the API through its own origin (nginx proxies /api), so CORS only
  // matters for direct calls to the API from an allowed origin.
  app.use('/api/*', cors({ origin: options.corsOrigins ?? DEFAULT_CORS_ORIGINS, exposeHeaders: ['x-cache'] }))

  const api = new Hono()
  api.get('/health', (c) => c.json({ ok: true, version: APP_VERSION }))

  const reach = options.reachability
  const today = options.today ?? (() => todayIn())
  if (reach) {
    // Station search for the origin field: GET /api/stations?q=Fulda
    api.get('/stations', async (c) => {
      const q = (c.req.query('q') ?? '').trim()
      if (q.length < 2 || q.length > MAX_QUERY_LENGTH) {
        return c.json(apiError('bad_request', `q must have 2-${MAX_QUERY_LENGTH} characters`), 400)
      }
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
      const bad = (message: string, code = 'bad_request') => ({ error: apiError(code, message), status: 400 as const })
      const maxMinutes = q.maxMinutes === undefined ? MAX_MINUTES.default : Number(q.maxMinutes)
      if (!Number.isInteger(maxMinutes) || maxMinutes < MAX_MINUTES.min || maxMinutes > MAX_MINUTES.max) {
        return bad(`maxMinutes must be an integer ${MAX_MINUTES.min}-${MAX_MINUTES.max}`)
      }
      const now = today()
      const date = q.date ?? now
      const time = q.time ?? '09:00'
      if (!isValidDateTime(date, time)) return bad('date must be a real YYYY-MM-DD and time HH:MM')
      // ISO dates compare correctly as text.
      if (date < addDays(now, -DATE_RANGE.back) || date > addDays(now, DATE_RANGE.ahead)) {
        return bad(`date must be from yesterday to ${DATE_RANGE.ahead} days ahead`, 'date_out_of_range')
      }

      let origin
      if (q.lat !== undefined || q.lon !== undefined) {
        // Number('') is 0: an empty value must not become the point 0,0.
        const lat = q.lat?.trim() ? Number(q.lat) : NaN
        const lon = q.lon?.trim() ? Number(q.lon) : NaN
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          return bad('lat and lon must be valid coordinates')
        }
        if (!reach.isAllowedPoint({ lat, lon })) return bad('The point is outside the supported countries', 'origin_outside')
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

    // The AI verdict over the best towns: GET /api/verdict?<search>. Never fails because of the AI:
    // without it (no key, down, invalid answer) `verdict` is null and `fallback` is the formula's ranking.
    const verdicts = options.verdicts
    if (verdicts) {
      api.get('/verdict', async (c) => {
        const parsed = await parseSearch(c.req.query())
        if ('error' in parsed) return c.json(parsed.error, parsed.status)
        const { result, cached } = await verdicts.verdict(parsed.query)
        c.header('x-cache', cached ? 'HIT' : 'MISS')
        return c.json({ ok: true, ...result })
      })
    }
  }

  api.all('*', (c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.route('/api', api)

  app.notFound((c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.onError((err, c) => {
    if (err instanceof BusyError) {
      return c.json(apiError('busy', 'Too many new searches right now, try again in a minute'), 429)
    }
    if (err instanceof UpstreamError) {
      console.warn(err.message)
      return c.json(apiError('upstream_unavailable', 'A data source did not answer'), 502)
    }
    console.error(err)
    return c.json(apiError('internal', 'Internal server error'), 500)
  })

  return app
}
