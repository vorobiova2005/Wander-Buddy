import { describe, expect, it } from 'vitest'
import type { Place, Weather } from './enrichment/types.js'
import { comfort, DEFAULT_WEIGHTS, placesPart, score, SCORING, tripPart, weatherPart } from './scoring.js'

const place = (category: Place['category'], rating = 3): Place => ({
  id: `x:${category}${rating}`,
  name: category,
  category,
  rating,
  distance: 100,
  lat: 50,
  lon: 9,
})

// The worked example of docs/scoring.md: Schlüchtern from Fulda, Sat 21.11.2026 09:00, limit 120 min.
// Real data from /api/destinations on 17.11.2026.
const schluechtern = {
  minutes: 42,
  transfers: 0,
  maxMinutes: 120,
  weather: {
    date: '2026-11-21',
    code: 61,
    tempMax: 8.3,
    tempMin: 2,
    precipitationProbability: 49,
    precipitationMm: 5.9,
    windMaxKmh: 15.3,
    sunshineHours: 6.8,
  } satisfies Weather,
  places: [
    place('architecture'),
    place('historic'),
    place('architecture'),
    place('historic'),
    place('historic'),
    place('nature'),
    place('nature'),
    place('museum', 2),
    place('food', 1),
    place('food', 1),
    place('food', 1),
  ],
  sightsTotal: 7,
}

describe('score - the worked example from docs/scoring.md', () => {
  it('Schlüchtern: T = 0.650, W = 0.574, P = 0.615, S = 61.7', () => {
    expect(score(schluechtern, DEFAULT_WEIGHTS)).toEqual({
      total: 61.7,
      parts: { trip: 0.65, weather: 0.574, places: 0.615 },
      weatherUnknown: false,
      placesUnknown: false,
    })
  })

  it('uses the weights the owner chose: 0.4 / 0.3 / 0.3', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ trip: 0.4, weather: 0.3, places: 0.3 })
  })
})

describe('T - the trip', () => {
  it('is 1 at 0 minutes and 0 at the limit', () => {
    expect(tripPart(0, 0, 120)).toBe(1)
    expect(tripPart(120, 0, 120)).toBe(0)
    expect(tripPart(200, 0, 120)).toBe(0) // never negative
  })

  it('loses 15 % per transfer', () => {
    expect(tripPart(60, 1, 120)).toBeCloseTo(0.5 * 0.85)
    expect(tripPart(60, 2, 120)).toBeCloseTo(0.5 * 0.85 ** 2)
  })
})

describe('W - the weather', () => {
  const day = (over: Partial<Weather>): Weather => ({
    date: '2026-06-20',
    code: 0,
    tempMax: 20,
    tempMin: 10,
    precipitationProbability: 0,
    precipitationMm: 0,
    windMaxKmh: 5,
    sunshineHours: 10,
    ...over,
  })

  it('is 1 for a dry, sunny, pleasantly warm day', () => {
    expect(weatherPart(day({}))).toBeCloseTo(1)
  })

  it('falls with rain chance, clouds and cold', () => {
    expect(weatherPart(day({ precipitationProbability: 100 }))).toBeCloseTo(0.6)
    expect(weatherPart(day({ sunshineHours: 0 }))).toBeCloseTo(0.7)
    expect(weatherPart(day({ tempMax: 0 }))).toBeCloseTo(0.7)
  })

  it('is halved by a thunderstorm or freezing rain', () => {
    expect(weatherPart(day({ code: 95 }))).toBeCloseTo(0.5)
    expect(weatherPart(day({ code: 67 }))).toBeCloseTo(0.5)
  })

  it('judges by the amount of rain when the chance is unknown', () => {
    expect(weatherPart(day({ precipitationProbability: null, precipitationMm: 5 }))).toBeCloseTo(0.6)
    expect(weatherPart(day({ precipitationProbability: null, precipitationMm: 0 }))).toBeCloseTo(1)
  })

  it('without a forecast counts as average and says so', () => {
    const s = score({ ...schluechtern, weather: null }, DEFAULT_WEIGHTS)
    expect(s.parts.weather).toBe(SCORING.neutralWeather)
    expect(s.weatherUnknown).toBe(true)
  })

  it('comfort: 0 at 0 °C, 1 from 15 to 25 °C, 0 from 32 °C', () => {
    expect([comfort(-5), comfort(0), comfort(7.5), comfort(15), comfort(25), comfort(28.5), comfort(32), comfort(40)]).toEqual([
      0, 0, 0.5, 1, 1, 0.5, 0, 0,
    ])
  })
})

describe('P - the places', () => {
  it('grows with the number of sights, slower for big numbers (logarithm)', () => {
    const kinds = [place('museum'), place('historic'), place('nature'), place('architecture')]
    const p = (n: number) => placesPart(kinds, n)
    expect(p(100)).toBeCloseTo(1)
    expect(p(265)).toBeCloseTo(1) // capped
    expect(p(10) - p(1)).toBeGreaterThan(p(265) - p(100))
    expect(p(0)).toBeCloseTo(0.3) // variety only
  })

  it('rewards variety among the best sights; cafés are not sights', () => {
    expect(placesPart([place('historic'), place('historic')], 100)).toBeCloseTo(0.7 + 0.3 / 4)
    expect(placesPart([place('food'), place('food')], 0)).toBe(0)
  })

  it('counts places that were not looked up as average (0.5), not as "nothing to see", and says so', () => {
    const unknown = score({ ...schluechtern, places: [], sightsTotal: null }, DEFAULT_WEIGHTS)
    expect(unknown.parts.places).toBe(SCORING.neutralPlaces)
    expect(unknown.placesUnknown).toBe(true)
    // Looked up and really nothing there: that is a 0, and known.
    const empty = score({ ...schluechtern, places: [], sightsTotal: 0 }, DEFAULT_WEIGHTS)
    expect(empty.parts.places).toBe(0)
    expect(empty.placesUnknown).toBe(false)
  })

  it('uses the length of the list when the source does not give a total', () => {
    expect(placesPart([place('historic'), place('museum')], null)).toBeCloseTo(placesPart([place('historic'), place('museum')], 2))
  })
})

describe('score', () => {
  it('rejects weights that do not add up to 1', () => {
    expect(() => score(schluechtern, { trip: 0.5, weather: 0.5, places: 0.5 })).toThrow(/add up to 1/)
  })

  it('stays between 0 and 100', () => {
    const best = score(
      {
        minutes: 0,
        transfers: 0,
        maxMinutes: 120,
        weather: { ...schluechtern.weather, precipitationProbability: 0, sunshineHours: 12, tempMax: 20 },
        places: [place('museum'), place('historic'), place('nature'), place('architecture')],
        sightsTotal: 500,
      },
      DEFAULT_WEIGHTS,
    )
    const worst = score(
      { minutes: 120, transfers: 3, maxMinutes: 120, weather: { ...schluechtern.weather, code: 95, precipitationProbability: 100, sunshineHours: 0, tempMax: -3 }, places: [], sightsTotal: 0 },
      DEFAULT_WEIGHTS,
    )
    expect(best.total).toBe(100)
    expect(worst.total).toBe(0)
  })
})
