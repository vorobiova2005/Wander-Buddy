/**
 * The shapes the server answers with (server/src: destinations.ts, verdict.ts, ai/types.ts). Kept by hand: the
 * web app only reads them, and the server's tests pin the contract.
 */

export type Coordinates = { lat: number; lon: number }

export type Station = Coordinates & { id: string; name: string; country?: string }

export type Weather = {
  date: string
  /** WMO weather code (lib/weather.ts turns it into words and an icon). */
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
  id: string
  name: string
  category: PlaceCategory
  rating: number
  distance: number
}

export type Score = {
  total: number
  parts: { trip: number; weather: number; places: number }
  weatherUnknown: boolean
  placesUnknown: boolean
}

export type Destination = {
  id: string
  name: string
  kind: 'city' | 'town' | 'village'
  minutes: number
  transfers: number
  /** ISO instant. */
  arrival: string
  station: Station
  center: Coordinates
  weather: Weather | null
  places: Place[]
  sightsTotal: number | null
  score: Score
}

export type Enrichment = {
  weather: 'ok' | 'out_of_range' | 'unavailable'
  weatherSource: string
  placesSource: string
  placesFailures: number
  placesSkipped: number
  placesPaused: boolean
}

export type Destinations = {
  origin: Station & { locality: string | null }
  /** ISO instant of the departure. */
  departure: string
  date: string
  maxMinutes: number
  cities: Destination[]
  enrichment: Enrichment
}

export type AiMood = 'happy' | 'excited' | 'thoughtful' | 'worried'

export type QuestStep = { time: string; title: string; placeId?: string; description: string; xp: number }

export type Quest = { cityId: string; title: string; steps: QuestStep[] }

export type Verdict = {
  top: { id: string; reason: string }[]
  comparison: string
  warnings: { id?: string; text: string }[]
  quest: Quest
  character: { mood: AiMood; line: string }
}

export type AiStatus = 'ok' | 'disabled' | 'unavailable' | 'invalid' | 'no_candidates'

export type VerdictAnswer = {
  verdict: Verdict | null
  /** City ids by the formula, best first - the answer when there is no verdict. */
  fallback: string[]
  ai: { status: AiStatus; provider: string | null; model: string | null; problems: string[] }
}
