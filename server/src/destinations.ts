import { PersistentMap, TtlCache } from './cache.js'
import type { Place, PlacesNearby, PlacesProvider, Weather, WeatherProvider } from './enrichment/types.js'
import { mapLimit, type City, type Reachability, type ReachabilityQuery, type ReachabilityService } from './reachability.js'
import { DEFAULT_WEIGHTS, score, type Score, type Weights } from './scoring.js'
import { todayIn } from './time.js'
import type { Coordinates } from './transit/types.js'

/** A reachable town with what makes it worth the trip. */
export type Destination = City & {
  /** The forecast for the trip day at the town centre; null when there is none (see enrichment.weather). */
  weather: Weather | null
  /** Notable places around the town centre, best first; empty for villages, or when the source has none or failed. */
  places: Place[]
  /** How many notable sights the town has around its centre in all (the list is only the best); null if unknown. */
  sightsTotal: number | null
  /** How attractive the trip is, 0-100, with its parts (scoring.ts, docs/scoring.md). */
  score: Score
}

export type WeatherStatus = 'ok' | 'out_of_range' | 'unavailable'

export type Destinations = Omit<Reachability, 'cities'> & {
  date: string
  /** The weights the scores were computed with. */
  weights: Weights
  /** Best score first. */
  cities: Destination[]
  enrichment: {
    weather: WeatherStatus
    weatherSource: string
    placesSource: string
    /** Towns whose places could not be fetched in this search. */
    placesFailures: number
    /** Towns not asked for places in this search: villages, beyond the per-search cap, or the source is paused. */
    placesSkipped: number
    /** True while the places source is paused after repeated failures. */
    placesPaused: boolean
  }
}

type Deps = {
  reachability: ReachabilityService
  weather: WeatherProvider
  places: PlacesProvider
  /** Places are looked for within this distance of the town centre. */
  placesRadiusMeters?: number
  /** At most this many towns are asked for places per search (fastest first): protects the daily quota. */
  maxPlacesTowns?: number
  /** After this many failures in a row the places source is paused ... */
  breakerThreshold?: number
  /** ... for this long; meanwhile stored or empty lists are served. */
  breakerPauseMs?: number
  concurrency?: number
  weatherTtlMs?: number
  /** How long found places are trusted. Sights hardly change, so a month (saves the 5 000/day quota). */
  placesTtlMs?: number
  /** Where found places are kept between restarts and deploys (one store per places provider). */
  placesStore?: PersistentMap<StoredPlaces>
  /** Today in Europe/Berlin (injectable for tests). */
  today?: () => string
  now?: () => number
  /** Scoring weights; DEFAULT_WEIGHTS when not given. */
  weights?: Weights
}

export type StoredPlaces = PlacesNearby & { at: number }

export class DestinationService {
  private readonly weatherCache: TtlCache<Weather | null>
  private readonly placesStore: PersistentMap<StoredPlaces>
  private readonly placesTtlMs: number
  private readonly inflight = new Map<string, Promise<PlacesNearby>>()
  /** Circuit breaker for the places source: failures in a row and the time the pause ends. */
  private failuresInRow = 0
  private pausedUntil = 0

  constructor(private readonly deps: Deps) {
    this.weatherCache = new TtlCache(deps.weatherTtlMs ?? 3600_000, 5000)
    this.placesStore = deps.placesStore ?? new PersistentMap()
    this.placesTtlMs = deps.placesTtlMs ?? 30 * 24 * 3600_000
  }

  async destinations(
    query: ReachabilityQuery,
    options: { villages: boolean },
  ): Promise<{ result: Destinations; cached: boolean }> {
    const { result: reach, cached } = await this.deps.reachability.reachable(query)
    // Villages are filtered before enrichment: no requests for towns nobody will see.
    const cities = options.villages ? reach.cities : reach.cities.filter((c) => c.kind !== 'village')
    const date = todayIn('Europe/Berlin', query.departure)
    // Weather and places around the town centre, not the (sometimes suburban) fastest station.
    const points = cities.map((c) => c.center)
    // Places only for towns (not villages), the fastest first, at most maxPlacesTowns per search.
    const cap = this.deps.maxPlacesTowns ?? 40
    let eligible = 0
    const wantPlaces = cities.map((c) => c.kind !== 'village' && eligible++ < cap)

    const [weather, places] = await Promise.all([this.weatherFor(points, date), this.placesFor(points, wantPlaces)])
    const weights = this.deps.weights ?? DEFAULT_WEIGHTS

    return {
      cached,
      result: {
        ...reach,
        date,
        weights,
        cities: cities
          .map((c, i) => {
            const enriched = { weather: weather.list[i], ...places.list[i] }
            const s = score({ minutes: c.minutes, transfers: c.transfers, maxMinutes: reach.maxMinutes, ...enriched }, weights)
            return { ...c, ...enriched, score: s }
          })
          .sort((a, b) => b.score.total - a.score.total || a.minutes - b.minutes),
        enrichment: {
          weather: weather.status,
          weatherSource: this.deps.weather.name,
          placesSource: this.deps.places.name,
          placesFailures: places.failures,
          placesSkipped: places.skipped,
          placesPaused: places.paused,
        },
      },
    }
  }

  private async weatherFor(points: Coordinates[], date: string): Promise<{ status: WeatherStatus; list: (Weather | null)[] }> {
    const today = (this.deps.today ?? (() => todayIn()))()
    const ahead = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000)
    if (ahead < 0 || ahead > this.deps.weather.horizonDays) {
      return { status: 'out_of_range', list: points.map(() => null) }
    }

    const key = (p: Coordinates) => `${date}|${p.lat.toFixed(2)},${p.lon.toFixed(2)}`
    const missing = points.filter((p) => this.weatherCache.get(key(p)) === undefined)
    if (missing.length > 0) {
      try {
        const fresh = await this.deps.weather.daily(missing, date)
        missing.forEach((p, i) => this.weatherCache.set(key(p), fresh[i] ?? null))
      } catch (err) {
        console.warn(`Weather: ${(err as Error).message}`)
        return { status: 'unavailable', list: points.map((p) => this.weatherCache.get(key(p)) ?? null) }
      }
    }
    return { status: 'ok', list: points.map((p) => this.weatherCache.get(key(p)) ?? null) }
  }

  private async placesFor(
    points: Coordinates[],
    wanted: boolean[],
  ): Promise<{ failures: number; skipped: number; paused: boolean; list: PlacesNearby[] }> {
    const radius = this.deps.placesRadiusMeters ?? 3000
    const now = (this.deps.now ?? Date.now)()
    let failures = 0
    let skipped = 0

    const list = await mapLimit(points, this.deps.concurrency ?? 4, async (p, i) => {
      const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}|${radius}`
      const known = this.placesStore.get(key)
      const none: PlacesNearby = { places: [], sightsTotal: null }
      const stale = known ? { places: known.places, sightsTotal: known.sightsTotal } : none
      if (known && now - known.at < this.placesTtlMs) return stale
      // Not asked: a village, beyond the cap, or the source is paused. An outdated list still beats none.
      if (!wanted[i] || this.isPaused()) {
        skipped++
        return stale
      }
      const running = this.inflight.get(key)
      if (running) return running.catch(() => stale)
      const work = this.deps.places.near(p, radius).finally(() => this.inflight.delete(key))
      this.inflight.set(key, work)
      try {
        const found = await work
        this.placesStore.set(key, { at: now, ...found })
        this.failuresInRow = 0
        return found
      } catch (err) {
        failures++
        this.recordFailure()
        console.warn(`Places: ${(err as Error).message}`)
        return stale // not refreshed: asked again next time (unless paused)
      }
    })
    try {
      this.placesStore.save()
    } catch (err) {
      console.warn(`Could not save the places: ${(err as Error).message}`) // only a cache
    }
    return { failures, skipped, paused: this.isPaused(), list }
  }

  private isPaused(): boolean {
    return (this.deps.now ?? Date.now)() < this.pausedUntil
  }

  /** A source that keeps failing (down, or the day's quota spent) is left alone for a while. */
  private recordFailure(): void {
    this.failuresInRow++
    if (this.failuresInRow >= (this.deps.breakerThreshold ?? 3) && !this.isPaused()) {
      const pause = this.deps.breakerPauseMs ?? 10 * 60_000
      this.pausedUntil = (this.deps.now ?? Date.now)() + pause
      console.warn(`Places: ${this.failuresInRow} failures in a row, pausing ${this.deps.places.name} for ${pause / 60_000} min`)
    }
  }
}
