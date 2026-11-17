import { PersistentMap, TtlCache } from './cache.js'
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
}

export class ReachabilityService {
  private readonly cache: TtlCache<Reachability>
  private readonly origins = new TtlCache<Station | null>(24 * 3600_000)
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
  }

  get providerName(): string {
    return this.deps.transit.name
  }

  /** Stations for a free-text query: only in the allowed countries and only real name matches. */
  async findStations(text: string, limit = 5): Promise<Station[]> {
    const found = await this.deps.transit.findStations(text, limit * 2)
    return found
      .filter((s) => (s.country ? this.countries.has(s.country.toUpperCase()) : true) && namesMatch(text, s.name))
      .slice(0, limit)
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
      return this.once(`town|${k}`, async () => {
        lookups++
        try {
          const found = await this.deps.locality.localityAt(station)
          if (found) this.store.set(k, found)
          else this.unknownStations.set(k, true)
          return found
        } catch {
          failures++
          return null
        }
      })
    })
    try {
      this.store.save()
    } catch (err) {
      console.warn(`Could not save the station towns: ${(err as Error).message}`) // only a cache
    }

    const byTown = new Map<string, City>()
    stations.forEach((stop, i) => {
      const town = towns[i]
      if (!town || town.name === originTown?.name) return
      const current = byTown.get(town.name)
      if (current && !isFaster(stop, current)) return
      byTown.set(town.name, {
        id: slugify(town.name),
        name: town.name,
        kind: town.kind,
        minutes: stop.minutes,
        transfers: Math.max(0, stop.vehicles - 1),
        arrival: stop.arrival,
        station: { id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon },
      })
    })

    const result: Reachability = {
      origin: { ...query.origin, locality: originTown?.name ?? null },
      departure: query.departure.toISOString(),
      maxMinutes: query.maxMinutes,
      cities: [...byTown.values()].sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name)),
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

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
