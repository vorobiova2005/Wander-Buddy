import {
  UpstreamError,
  type Coordinates,
  type Locality,
  type LocalityResolver,
  type ReachableQuery,
  type ReachableStop,
  type Station,
  type TransitProvider,
} from './types.js'

/**
 * Transitous (https://transitous.org) - a free, community-run MOTIS instance for Europe.
 * Usage policy: https://transitous.org/api/ - open-source and non-commercial projects, a User-Agent with
 * name, version and contact, light use (one-to-all only on a user's action, cached), attribution in the UI.
 */

/** What the Deutschland-Ticket covers: everything except long-distance trains, coaches and planes. */
const REGIONAL_MODES = ['REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN', 'BUS', 'TRAM', 'SUBWAY', 'FERRY']
const RAIL_MODES = new Set(['REGIONAL_FAST_RAIL', 'REGIONAL_RAIL', 'SUBURBAN', 'RAIL', 'HIGHSPEED_RAIL', 'LONG_DISTANCE', 'NIGHT_RAIL'])
/** OSM place categories that make a municipality a town rather than a village. */
const TOWN_CATEGORIES = new Set(['city', 'town'])

type Area = { name: string; adminLevel: number }
type Match = {
  id: string
  name: string
  type: string
  category?: string
  country?: string
  lat: number
  lon: number
  areas?: Area[]
}
type Place = { name: string; stopId?: string; lat: number; lon: number; arrival?: string; modes?: string[] }
type Reachable = { all?: { place: Place; duration: number; k: number }[] }

export type TransitousOptions = {
  userAgent: string
  baseUrl?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export class Transitous implements TransitProvider, LocalityResolver {
  readonly name = 'transitous'
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: TransitousOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.transitous.org'
    this.timeoutMs = options.timeoutMs ?? 20_000
    this.fetchImpl = options.fetch ?? fetch
  }

  async findStations(text: string, limit: number): Promise<Station[]> {
    const matches = await this.get<Match[]>('/api/v1/geocode', { text, type: 'STOP', numResults: String(limit) })
    return matches.map((m) => ({
      id: m.id,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      area: municipalityOf(m.areas)?.name,
      country: m.country,
    }))
  }

  async reachableStops(query: ReachableQuery): Promise<ReachableStop[]> {
    const body = await this.get<Reachable>('/api/v6/one-to-all', {
      one: `${query.origin.lat},${query.origin.lon}`,
      time: query.departure.toISOString(),
      maxTravelTime: String(query.maxMinutes),
      arriveBy: 'false',
      transitModes: REGIONAL_MODES.join(','),
    })
    return (body.all ?? []).map(({ place, duration, k }) => ({
      id: place.stopId ?? `${place.lat},${place.lon}`,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      minutes: duration,
      vehicles: k,
      arrival: place.arrival ?? '',
      rail: (place.modes ?? []).some((m) => RAIL_MODES.has(m)),
    }))
  }

  async localityAt(point: Coordinates): Promise<Locality | null> {
    const near = await this.get<Match[]>('/api/v1/reverse-geocode', { place: `${point.lat},${point.lon}`, type: 'STOP' })
    const municipality = near.map((m) => municipalityOf(m.areas)).find(Boolean)
    if (!municipality) return null

    // The place itself in OSM: its category (town or village) and its centre.
    let places: Match[]
    try {
      places = await this.get<Match[]>('/api/v1/geocode', {
        text: municipality.name,
        type: 'PLACE',
        place: `${point.lat},${point.lon}`,
        numResults: '5',
      })
    } catch (err) {
      // A city that is its own district is a city anyway; only its centre is missing (the station stands in).
      if (municipality.adminLevel < 8) return { name: municipality.name, kind: 'city' }
      throw err
    }
    const same = places.filter(
      (p) =>
        p.name === municipality.name &&
        p.areas?.some((a) => a.name === municipality.name && a.adminLevel === municipality.adminLevel),
    )
    const settlement = same.find((p) => TOWN_CATEGORIES.has(p.category ?? '')) ?? same[0]
    const center =
      settlement && Number.isFinite(settlement.lat) && Number.isFinite(settlement.lon)
        ? { lat: settlement.lat, lon: settlement.lon }
        : undefined

    // A municipality on admin level 6 is a city that is its own district (Frankfurt, Kassel, Würzburg).
    if (municipality.adminLevel < 8) return { name: municipality.name, kind: 'city', center }
    const isTown = same.some((p) => TOWN_CATEGORIES.has(p.category ?? ''))
    return { name: municipality.name, kind: isTown ? 'town' : 'village', center }
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, this.baseUrl)
    url.search = new URLSearchParams(params).toString()
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new UpstreamError(this.name, `${path} failed: ${(err as Error).message}`)
    }
    if (!res.ok) throw new UpstreamError(this.name, `${path} answered HTTP ${res.status}`)
    try {
      return (await res.json()) as T
    } catch {
      throw new UpstreamError(this.name, `${path} answered something that is not JSON`)
    }
  }
}

/**
 * The municipality from OSM admin areas: level 8 (Gemeinde/Stadt) when present; otherwise a level-6 area
 * that is not a district (Landkreis, Main-Kinzig-Kreis, ...) - that is a city which is its own district.
 */
export function municipalityOf(areas: Area[] | undefined): Area | null {
  if (!areas) return null
  const level8 = areas.find((a) => a.adminLevel === 8)
  if (level8) return level8
  const level6 = areas.find((a) => a.adminLevel === 6)
  if (level6 && !/kreis/i.test(level6.name)) return level6
  return null
}
