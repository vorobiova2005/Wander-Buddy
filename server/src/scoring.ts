/**
 * The scoring formula - how attractive a destination is for a day trip. A pure function: same input, same score.
 * Explained with a worked example in docs/scoring.md (formula 3.1 of the coursework).
 *
 *   S = 100 · (w_trip · T + w_weather · W + w_places · P),   w_trip + w_weather + w_places = 1
 *
 * Every part is between 0 (bad) and 1 (good):
 *   T - the trip:    shorter than the user's limit is better, every transfer costs a share
 *   W - the weather: little rain, sunshine, a comfortable temperature; storms and freezing rain halve it
 *   P - the places:  how much there is to see (all notable sights around) and how varied the best are
 */
import type { Place, Weather } from './enrichment/types.js'

export type Weights = { trip: number; weather: number; places: number }

/**
 * "Balance", chosen by the owner on 17.11.2026 from three variants compared on real Fulda data
 * (docs/scoring.md): the trip a little more important, weather and places equal.
 */
export const DEFAULT_WEIGHTS: Weights = { trip: 0.4, weather: 0.3, places: 0.3 }

export type ScoreInput = {
  minutes: number
  transfers: number
  /** The user's travel limit - the trip part is relative to it. */
  maxMinutes: number
  weather: Weather | null
  places: Place[]
  /** Notable sights around the town centre in all; null if the source does not say. */
  sightsTotal: number | null
}

export type Score = {
  /** 0-100, rounded to one decimal. */
  total: number
  /** The three parts, 0-1, rounded to three decimals - for the UI, the AI and the explanation. */
  parts: { trip: number; weather: number; places: number }
  /** True when there was no forecast and the weather part is the neutral 0.5. */
  weatherUnknown: boolean
  /** True when the places were not looked up (source failed, paused, beyond the cap) and P is the neutral 0.5. */
  placesUnknown: boolean
}

/** The constants of the formula, named so the documentation can point at them. */
export const SCORING = {
  /** Each transfer keeps this share of the trip part (0.85 → one transfer costs 15 %). */
  transferFactor: 0.85,
  /** Weather without a forecast counts as average. */
  neutralWeather: 0.5,
  /** Places that were not looked up count as average too: unknown is not "nothing to see". */
  neutralPlaces: 0.5,
  /** Weights inside W. */
  weatherMix: { dry: 0.4, sun: 0.3, warmth: 0.3 },
  /** Sunshine hours that count as "full sun" for a day. */
  fullSunHours: 10,
  /** Comfortable maximum temperature, °C: full marks between these, falling to 0 at the outer bounds. */
  comfort: { cold: 0, low: 15, high: 25, hot: 32 },
  /** WMO codes that halve W: freezing rain/drizzle, heavy snow and showers of it, thunderstorms. */
  severeCodes: new Set([56, 57, 66, 67, 75, 86, 95, 96, 99]),
  /** Weights inside P. */
  placesMix: { amount: 0.7, variety: 0.3 },
  /** Notable sights around the centre that count as "plenty to see" (Kassel has ~100, Frankfurt ~265). */
  plentySights: 100,
  /** Different kinds of sights (museum, historic, ...) among the best ones that count as "varied". */
  varietyKinds: 4,
} as const

export function score(input: ScoreInput, weights: Weights): Score {
  const sum = weights.trip + weights.weather + weights.places
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`weights must add up to 1, got ${sum}`)

  const trip = tripPart(input.minutes, input.transfers, input.maxMinutes)
  const weather = input.weather ? weatherPart(input.weather) : SCORING.neutralWeather
  // Nothing known about the places (no list, no total) - the source was not asked or failed.
  const placesUnknown = input.sightsTotal === null && input.places.length === 0
  const places = placesUnknown ? SCORING.neutralPlaces : placesPart(input.places, input.sightsTotal)
  const total = 100 * (weights.trip * trip + weights.weather * weather + weights.places * places)

  return {
    total: round(total, 1),
    parts: { trip: round(trip, 3), weather: round(weather, 3), places: round(places, 3) },
    weatherUnknown: input.weather === null,
    placesUnknown,
  }
}

/** T = (1 - minutes / maxMinutes) · 0.85^transfers */
export function tripPart(minutes: number, transfers: number, maxMinutes: number): number {
  const closeness = clamp(1 - minutes / maxMinutes)
  return closeness * SCORING.transferFactor ** Math.max(0, transfers)
}

/** W = 0.4 · dry + 0.3 · sun + 0.3 · warmth, halved for severe weather */
export function weatherPart(w: Weather): number {
  const { dry, sun, warmth } = SCORING.weatherMix
  // No probability from the source: judge by the amount (5 mm or more = surely wet).
  const rainChance = w.precipitationProbability ?? clamp(w.precipitationMm / 5) * 100
  const value =
    dry * (1 - clamp(rainChance / 100)) + sun * clamp(w.sunshineHours / SCORING.fullSunHours) + warmth * comfort(w.tempMax)
  return SCORING.severeCodes.has(w.code) ? value / 2 : value
}

/** How pleasant a maximum temperature is: 0 at ≤ 0 °C, 1 between 15 and 25 °C, 0 at ≥ 32 °C, linear between. */
export function comfort(tempMax: number): number {
  const { cold, low, high, hot } = SCORING.comfort
  if (tempMax <= low) return clamp((tempMax - cold) / (low - cold))
  if (tempMax <= high) return 1
  return clamp((hot - tempMax) / (hot - high))
}

/**
 * P = 0.7 · min(1, ln(1 + N) / ln(1 + 100)) + 0.3 · min(1, kinds / 4)
 * N - notable sights around the centre in all (the list only shows the best; without N its length stands in);
 * the logarithm makes 1 → 10 sights matter more than 200 → 265. Kinds - categories among the listed sights.
 * Cafés do not count as sights.
 */
export function placesPart(places: Place[], sightsTotal: number | null): number {
  const sights = places.filter((p) => p.category !== 'food')
  const n = sightsTotal ?? sights.length
  const amount = clamp(Math.log(1 + n) / Math.log(1 + SCORING.plentySights))
  const variety = clamp(new Set(sights.map((p) => p.category)).size / SCORING.varietyKinds)
  return SCORING.placesMix.amount * amount + SCORING.placesMix.variety * variety
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits
