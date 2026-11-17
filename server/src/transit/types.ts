/**
 * The contract between Wander Buddy and any source of public-transport data.
 *
 * The rest of the server talks only to these interfaces. Switching to another API or library
 * (an unofficial DB client, a self-hosted MOTIS, ...) means writing one more implementation and
 * selecting it with TRANSIT_PROVIDER / LOCALITY_RESOLVER - see transit/index.ts.
 */

export type Coordinates = { lat: number; lon: number }

/** A stop or station as the provider names it. */
export type Station = Coordinates & {
  id: string
  name: string
  /** The municipality the station belongs to, when the provider knows it (for display only). */
  area?: string
  /** ISO 3166-1 alpha-2 country code, when the provider knows it. */
  country?: string
}

export type ReachableStop = Station & {
  /** Minutes from the requested departure time to the arrival, waiting for the first vehicle included. */
  minutes: number
  /** How many vehicles are used: 1 = direct, 2 = one transfer, ... */
  vehicles: number
  /** Arrival time, ISO 8601 (UTC). */
  arrival: string
  /** True for a railway station (regional or long-distance trains stop there). */
  rail: boolean
}

export type ReachableQuery = {
  origin: Coordinates
  /** Departure time (UTC). */
  departure: Date
  maxMinutes: number
}

/** `city` - a city that is its own district (kreisfreie Stadt); `town` - a town; `village` - everything smaller. */
export type LocalityKind = 'city' | 'town' | 'village'

export type Locality = {
  name: string
  kind: LocalityKind
  /** The town's centre (its place node in OSM), when known: weather and places are looked up there. */
  center?: Coordinates
}

export interface TransitProvider {
  readonly name: string
  /** Stations matching a free-text query, best match first. */
  findStations(text: string, limit: number): Promise<Station[]>
  /** Every stop reachable from the origin by regional transport only (no ICE/IC), within maxMinutes. */
  reachableStops(query: ReachableQuery): Promise<ReachableStop[]>
}

export interface LocalityResolver {
  readonly name: string
  /** The municipality at a point, or null when it cannot be told. */
  localityAt(point: Coordinates): Promise<Locality | null>
}

/** A data source failed or answered something unusable. Mapped to HTTP 502 by the API. */
export class UpstreamError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`)
    this.name = 'UpstreamError'
  }
}
