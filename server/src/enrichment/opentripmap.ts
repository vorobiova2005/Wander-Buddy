import { UpstreamError, type Coordinates } from '../transit/types.js'
import type { Place, PlaceCategory, PlacesNearby, PlacesProvider } from './types.js'

/**
 * OpenTripMap (https://dev.opentripmap.org) - free plan: non-commercial, 5 000 requests/day, 10/second;
 * data under ODbL (from OpenStreetMap, Wikidata, Wikipedia). Needs OPENTRIPMAP_API_KEY.
 *
 * Three calls per town: the best sights (rated 2+ or cultural heritage), a few cafés, and how many notable
 * sights (rated 3) there are in all. Their limiter is stricter than the advertised 10 a second in
 * bursts, so calls are spaced (5/s) and a 429 is retried twice with a growing pause.
 */

type Feature = {
  xid: string
  name?: string
  kinds?: string
  rate?: number | string
  dist?: number
  wikidata?: string
  point?: { lat: number; lon: number }
}

const SIGHTS = 'museums,historic,architecture,natural,cultural,religion'
const CAFES = 'cafes'

export type OpenTripMapOptions = {
  apiKey: string
  userAgent: string
  baseUrl?: string
  timeoutMs?: number
  sights?: number
  cafes?: number
  /** Minimum gap between requests; 200 ms = 5 per second, well under the plan's 10. */
  minIntervalMs?: number
  /** Pause before retrying a 429 (doubled on the second retry). */
  retryAfterMs?: number
  fetch?: typeof fetch
}

export class OpenTripMap implements PlacesProvider {
  readonly name = 'opentripmap'
  private readonly fetchImpl: typeof fetch
  private nextSlot = 0

  constructor(private readonly options: OpenTripMapOptions) {
    this.fetchImpl = options.fetch ?? fetch
  }

  async near(point: Coordinates, radiusMeters: number): Promise<PlacesNearby> {
    const [sights, cafes, sightsTotal] = await Promise.all([
      this.list(point, radiusMeters, SIGHTS, '2', this.options.sights ?? 8),
      this.list(point, radiusMeters, CAFES, '1', this.options.cafes ?? 3),
      this.count(point, radiusMeters, SIGHTS, '3'),
    ])
    // One object can come in pieces (a railway line in segments, a park in parts): one entry per name.
    const seen = new Set<string>()
    const places = [...sights, ...cafes].filter((p) => {
      const key = p.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { places, sightsTotal }
  }

  /** How many objects of these kinds and rating (and better) there are in the radius. */
  private async count(point: Coordinates, radius: number, kinds: string, rate: string): Promise<number> {
    const body = (await this.radius(point, radius, { kinds, rate, format: 'count' })) as { count?: unknown }
    if (typeof body?.count !== 'number') throw new UpstreamError(this.name, 'count answered without a number')
    return body.count
  }

  private async list(point: Coordinates, radius: number, kinds: string, rate: string, limit: number): Promise<Place[]> {
    // More than needed: unnamed objects and pieces of the same object are dropped below.
    const body = await this.radius(point, radius, { kinds, rate, format: 'json', limit: String(limit * 3) })
    if (!Array.isArray(body)) throw new UpstreamError(this.name, 'radius answered something that is not a list')

    return (body as Feature[])
      .filter((f) => f.name?.trim() && f.point)
      .map((f) => ({
        id: `otm:${f.xid}`,
        name: f.name!.trim(),
        category: categoryOf(f.kinds ?? ''),
        rating: ratingOf(f.rate),
        distance: Math.round(f.dist ?? 0),
        lat: f.point!.lat,
        lon: f.point!.lon,
        ...(f.wikidata ? { wikidata: f.wikidata } : {}),
      }))
      .sort((a, b) => b.rating - a.rating || a.distance - b.distance)
      .filter((p, i, all) => all.findIndex((q) => q.name.toLowerCase() === p.name.toLowerCase()) === i)
      .slice(0, limit)
  }

  /** One /places/radius call: spaced, 429 retried, errors as UpstreamError (never with the URL - it holds the key). */
  private async radius(point: Coordinates, radius: number, params: Record<string, string>): Promise<unknown> {
    const url = new URL('/0.1/en/places/radius', this.options.baseUrl ?? 'https://api.opentripmap.com')
    url.search = new URLSearchParams({
      radius: String(Math.round(radius)),
      lat: point.lat.toFixed(5),
      lon: point.lon.toFixed(5),
      ...params,
      apikey: this.options.apiKey,
    }).toString()

    const call = async (): Promise<Response> => {
      await this.slot()
      try {
        return await this.fetchImpl(url, {
          headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        })
      } catch (err) {
        throw new UpstreamError(this.name, `radius failed: ${(err as Error).message}`)
      }
    }
    let res = await call()
    for (let attempt = 1; res.status === 429 && attempt <= 2; attempt++) {
      await sleep((this.options.retryAfterMs ?? 1000) * attempt)
      res = await call()
    }
    if (!res.ok) throw new UpstreamError(this.name, `radius answered HTTP ${res.status}`)
    try {
      return await res.json()
    } catch {
      throw new UpstreamError(this.name, 'radius answered something that is not JSON')
    }
  }

  /** Waits for this request's turn, so that requests leave at most every `minIntervalMs`. */
  private async slot(): Promise<void> {
    const gap = this.options.minIntervalMs ?? 200
    const now = Date.now()
    const at = Math.max(now, this.nextSlot)
    this.nextSlot = at + gap
    if (at > now) await sleep(at - now)
  }
}

/** OpenTripMap "kinds" is a comma list from a hierarchy; the first match from the most specific wins. */
export function categoryOf(kinds: string): PlaceCategory {
  const k = kinds.split(',')
  if (k.some((x) => x === 'cafes' || x === 'foods' || x === 'restaurants')) return 'food'
  if (k.includes('museums')) return 'museum'
  if (k.some((x) => x === 'historic' || x.startsWith('historic_') || x === 'castles' || x === 'fortifications')) return 'historic'
  if (k.includes('natural')) return 'nature'
  if (k.some((x) => x === 'architecture' || x === 'religion' || x === 'churches' || x === 'towers' || x === 'bridges')) {
    return 'architecture'
  }
  if (k.includes('cultural') || k.includes('theatres_and_entertainments')) return 'culture'
  return 'other'
}

/**
 * Popularity 1-3. OpenTripMap marks cultural heritage as "1h".."3h" in its docs and as 5..7 in JSON
 * (heritage flag + 4); both become the plain 1-3.
 */
export function ratingOf(rate: number | string | undefined): number {
  const n = Number.parseInt(String(rate ?? '0'), 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n > 3 ? Math.min(3, n - 4) : n
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
