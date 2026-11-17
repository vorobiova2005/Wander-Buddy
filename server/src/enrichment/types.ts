/**
 * The contract for the data that makes a town worth the trip: weather on the day and places to see.
 * Same rule as transit/: the rest of the server knows only these interfaces; a source is swapped with
 * WEATHER_PROVIDER / PLACES_PROVIDER (enrichment/index.ts).
 */
import type { Coordinates } from '../transit/types.js'

/** The forecast for one day at one point. Units: °C, %, mm, km/h, hours. */
export type Weather = {
  date: string
  /** WMO weather code (0 clear ... 99 thunderstorm); the web app turns it into words and an icon. */
  code: number
  tempMax: number
  tempMin: number
  precipitationProbability: number | null
  precipitationMm: number
  windMaxKmh: number
  sunshineHours: number
}

export type PlaceCategory = 'museum' | 'historic' | 'architecture' | 'nature' | 'culture' | 'food' | 'other'

export type Place = Coordinates & {
  /** The source's own id, prefixed with the source name (otm:N123). */
  id: string
  name: string
  category: PlaceCategory
  /** Popularity 1-3 from the source; 0 when unknown. */
  rating: number
  /** Metres from the point it was looked up from (the town centre). */
  distance: number
  wikidata?: string
}

export interface WeatherProvider {
  readonly name: string
  /** How many days ahead (today = 0) a forecast exists. */
  readonly horizonDays: number
  /** Forecasts for many points on one date, in the same order; null where the source has none. */
  daily(points: Coordinates[], date: string): Promise<(Weather | null)[]>
}

export type PlacesNearby = {
  /** A short list of the best places, best first. */
  places: Place[]
  /** How many notable sights there are within the radius in total (the list above is only the top); null if unknown. */
  sightsTotal: number | null
}

export interface PlacesProvider {
  readonly name: string
  /** Notable places within `radiusMeters`: the best few and how many there are in all. */
  near(point: Coordinates, radiusMeters: number): Promise<PlacesNearby>
}
