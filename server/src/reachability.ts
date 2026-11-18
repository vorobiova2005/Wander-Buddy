import { BusyError, PersistentMap, RateLimiter, TtlCache } from './cache.js'
import type {
  Coordinates,
  Locality,
  LocalityKind,
  LocalityResolver,
  ReachableStop,
  Station,
  TransitProvider,
} from './transit/types.js'

/** A destination town with the fastest way to reach it. */
export type City = {
  /** Stable id (slug of the name) - the AI verdict refers to cities by it. */
  id: string
  name: string
  kind: LocalityKind
  /** Minutes from the chosen departure time to the arrival, waiting included. */
  minutes: number
  transfers: number
  arrival: string
  station: Station
  /** The town centre (falls back to the station): where weather and places are looked up. */
  center: Coordinates
}

export type Reachability = {
  origin: Station & { locality: string | null }
  departure: string
  maxMinutes: number
  cities: City[]
  /** How much raw data became the answer - for the measurements chapter. */
  stats: { stops: number; railStops: number; stations: number; localityLookups: number; localityFailures: number }
}

export type ReachabilityQuery = { origin: Station; departure: Date; maxMinutes: number }

type Deps = {
  transit: TransitProvider
  locality: LocalityResolver
  /** Where station → town answers are kept between restarts (one store per resolver). */
  localityStore?: PersistentMap<Locality>
  /** How long a reachability answer is reused. */
  ttlMs?: number
  /** Parallel locality lookups (politeness towards the geocoder). */
  concurrency?: number
  /** Rail stops closer than this are one station (platforms, several feeds for the same station). */
  stationRadiusMeters?: number
  /** Countries an origin may be in (ISO codes). Stops a typo from becoming a search in New York. */
  countries?: string[]
  /** New (uncached) searches allowed per minute for the whole server - politeness towards Transitous. */
  searchesPerMinute?: number
  now?: () => number
}

/**
 * Rough boxes [south, west, north, east] of the countries an origin may be in. A point outside every allowed
 * country's box is refused before any request; a country without a box here is not checked (no false refusals).
 */
export const COUNTRY_BOXES: Record<string, [number, number, number, number]> = {
  DE: [47.2, 5.8, 55.1, 15.1],
  AT: [46.3, 9.5, 49.1, 17.2],
  CH: [45.8, 5.9, 47.9, 10.5],
  NL: [50.7, 3.3, 53.6, 7.3],
  BE: [49.4, 2.5, 51.6, 6.5],
  LU: [49.4, 5.7, 50.2, 6.6],
  DK: [54.5, 8.0, 57.8, 15.2],
  CZ: [48.5, 12.0, 51.1, 18.9],
  PL: [49.0, 14.1, 54.9, 24.2],
  FR: [41.3, -5.2, 51.1, 9.6],
}

/** Two stations of towns with the same name farther apart than this are two different towns ("Neuhof"). */
const SAME_TOWN_METERS = 15_000

export class ReachabilityService {
  private readonly cache: TtlCache<Reachability>
  private readonly origins = new TtlCache<Station | null>(24 * 3600_000)
  /** Station suggestions while typing: the same letters are asked again and again. */
  private readonly suggestions = new TtlCache<Station[]>(24 * 3600_000, 2000)
  private readonly searches: RateLimiter
  /** Origin towns: memory only - an origin can be a user's own location, it is never written to disk. */
  private readonly originTowns = new TtlCache<Locality | null>(24 * 3600_000)
  /** Stations the resolver could not place: retried after a day, never stored for good. */
  private readonly unknownStations = new TtlCache<true>(24 * 3600_000, 5000)
  private readonly store: PersistentMap<Locality>
  /** Work in progress, shared by identical concurrent requests (a double click must not ask twice). */
  private readonly inflight = new Map<string, Promise<unknown>>()
  private readonly concurrency: number
  private readonly radius: number
  private readonly countries: Set<string>

  constructor(private readonly deps: Deps) {
    this.cache = new TtlCache(deps.ttlMs ?? 6 * 3600_000)
    this.store = deps.localityStore ?? new PersistentMap()
    this.concurrency = deps.concurrency ?? 4
    this.radius = deps.stationRadiusMeters ?? 400
    this.countries = new Set((deps.countries ?? ['DE']).map((c) => c.toUpperCase()))
    this.searches = new RateLimiter(deps.searchesPerMinute ?? 30, 60_000, deps.now)
  }

  /** Is a point inside one of the allowed countries (by their rough boxes)? */
  isAllowedPoint(p: Coordinates): boolean {
    return [...this.countries].some((c) => {
      const box = COUNTRY_BOXES[c]
      if (!box) return true
      const [south, west, north, east] = box
      return p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east
    })
  }

  get providerName(): string {
    return this.deps.transit.name
  }

  /** Stations for a free-text query: only in the allowed countries and only real name matches. */
  async findStations(text: string, limit = 5): Promise<Station[]> {
    const key = `${limit}|${text.trim().toLowerCase()}`
    const known = this.suggestions.get(key)
    if (known) return known
    return this.once(`stations|${key}`, async () => {
      const found = await this.deps.transit.findStations(text, limit * 2)
      const list = found
        .filter((s) => (s.country ? this.countries.has(s.country.toUpperCase()) : true) && namesMatch(text, s.name))
        .slice(0, limit)
      this.suggestions.set(key, list)
      return list
    })
  }

  /** The best-matching station for a free-text origin, cached for a day. */
  async findOrigin(text: string): Promise<Station | null> {
    const key = text.trim().toLowerCase()
    const known = this.origins.get(key)
    if (known !== undefined) return known
    return this.once(`origin|${key}`, async () => {
      const [best] = await this.findStations(text, 1)
      this.origins.set(key, best ?? null)
      return best ?? null
    })
  }

  async reachable(query: ReachabilityQuery): Promise<{ result: Reachability; cached: boolean }> {
    const key = [
      this.deps.transit.name,
      pointKey(query.origin),
      query.departure.toISOString(),
      query.maxMinutes,
    ].join('|')
    const hit = this.cache.get(key)
    if (hit) return { result: hit, cached: true }
    // A new search costs Transitous a heavy one-to-all query and many lookups: limited for the whole server.
    // Joining a search already running costs nothing.
    if (!this.inflight.has(`reach|${key}`) && !this.searches.tryTake()) throw new BusyError()
    const result = await this.once(`reach|${key}`, () => this.compute(query, key))
    return { result, cached: false }
  }

  private async compute(query: ReachabilityQuery, key: string): Promise<Reachability> {
    const stops = await this.deps.transit.reachableStops({
      origin: query.origin,
      departure: query.departure,
      maxMinutes: query.maxMinutes,
    })
    const railStops = stops.filter((s) => s.rail)
    const stations = mergeNearbyStops(railStops, this.radius)

    // The origin's own town is left out of the answer; without it the answer would be wrong, so this may fail.
    const originTown = await this.originTown(query.origin)

    let lookups = 0
    let failures = 0
    const towns = await mapLimit(stations, this.concurrency, async (station) => {
      const k = pointKey(station)
      const known = this.store.get(k)
      if (known) return known
      if (this.unknownStations.get(k)) return null
      // Shared with a concurrent search for the same station - and each search counts a failure as its own gap.
      const { town, failed } = await this.once(`town|${k}`, async () => {
        lookups++
        try {
          const found = await this.deps.locality.localityAt(station)
          if (found) this.store.set(k, found)
          else this.unknownStations.set(k, true)
          return { town: found, failed: false }
        } catch {
          return { town: null, failed: true }
        }
      })
      if (failed) failures++
      return town
    })
    try {
      this.store.save()
    } catch (err) {
      console.warn(`Could not save the station towns: ${(err as Error).message}`) // only a cache
    }

    // One entry per town: the stations of a town are grouped by its name, but two towns with the same name far
    // apart (two "Neuhof"s) stay two entries with different ids. The fastest station represents the town.
    const byTown: City[] = []
    const originCenter = originTown ? (originTown.center ?? query.origin) : null
    stations.forEach((stop, i) => {
      const town = towns[i]
      if (!town) return
      const center = town.center ?? { lat: stop.lat, lon: stop.lon }
      if (originCenter && town.name === originTown?.name && distanceMeters(center, originCenter) <= SAME_TOWN_METERS) return
      const at = byTown.findIndex((c) => c.name === town.name && distanceMeters(c.center, center) <= SAME_TOWN_METERS)
      if (at >= 0 && !isFaster(stop, byTown[at])) return
      const city: City = {
        id: '', // set below, once all towns of this name are known
        name: town.name,
        kind: town.kind,
        minutes: stop.minutes,
        transfers: Math.max(0, stop.vehicles - 1),
        arrival: stop.arrival,
        station: { id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon },
        center,
      }
      if (at >= 0) byTown[at] = city
      else byTown.push(city)
    })
    assignIds(byTown)

    const result: Reachability = {
      origin: { ...query.origin, locality: originTown?.name ?? null },
      departure: query.departure.toISOString(),
      maxMinutes: query.maxMinutes,
      cities: byTown.sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name)),
      stats: {
        stops: stops.length,
        railStops: railStops.length,
        stations: stations.length,
        localityLookups: lookups,
        localityFailures: failures,
      },
    }
    // An answer with gaps (some towns could not be looked up) is kept only briefly, so it heals soon.
    this.cache.set(key, result, failures > 0 ? 2 * 60_000 : undefined)
    return result
  }

  private async originTown(point: Coordinates): Promise<Locality | null> {
    const k = pointKey(point)
    const known = this.originTowns.get(k)
    if (known !== undefined) return known
    return this.once(`originTown|${k}`, async () => {
      const found = await this.deps.locality.localityAt(point)
      this.originTowns.set(k, found)
      return found
    })
  }

  /** Runs `work` once per key at a time; concurrent callers with the same key share the promise. */
  private once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key)
    if (running) return running as Promise<T>
    const promise = work().finally(() => this.inflight.delete(key))
    this.inflight.set(key, promise)
    return promise
  }
}

/**
 * Ids the AI and the player's progress refer to: the slug of the name ("hunfeld"). Towns sharing a name in one answer
 * get their centre added ("neuhof-5046-961") - the same town keeps the same id whichever of them is faster to reach.
 */
export function assignIds(cities: City[]): void {
  const count = new Map<string, number>()
  for (const c of cities) count.set(c.name, (count.get(c.name) ?? 0) + 1)
  for (const c of cities) {
    const slug = slugify(c.name)
    c.id = count.get(c.name)! > 1 ? `${slug}-${Math.round(c.center.lat * 100)}-${Math.round(c.center.lon * 100)}` : slug
  }
}

function pointKey(p: Coordinates): string {
  return `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`
}

/**
 * Does a station name really answer the query? Geocoders are fuzzy: "Atlantisxyz" comes back as
 * "Atlantic Av". Every word of the query (3+ letters) must start a word of the name.
 */
export function namesMatch(query: string, name: string): boolean {
  const words = (s: string) => slugify(s).split('-').filter(Boolean)
  const nameWords = words(name)
  const queryWords = words(query).filter((w) => w.length >= 3)
  return queryWords.length > 0 && queryWords.every((q) => nameWords.some((n) => n.startsWith(q)))
}

function isFaster(stop: ReachableStop, city: City): boolean {
  return stop.minutes < city.minutes || (stop.minutes === city.minutes && stop.vehicles - 1 < city.transfers)
}

/** Stops within `radiusMeters` of a faster one are the same station; the fastest stop represents it. */
export function mergeNearbyStops(stops: ReachableStop[], radiusMeters: number): ReachableStop[] {
  const sorted = [...stops].sort((a, b) => a.minutes - b.minutes || a.vehicles - b.vehicles)
  const kept: ReachableStop[] = []
  for (const stop of sorted) {
    if (!kept.some((k) => distanceMeters(k, stop) <= radiusMeters)) kept.push(stop)
  }
  return kept
}

export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/ß/g, 'ss')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Runs `fn` over `items` with at most `limit` running at once, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
