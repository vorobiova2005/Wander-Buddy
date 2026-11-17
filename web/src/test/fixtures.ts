import type { Destination, Destinations, VerdictAnswer } from '../api/types'

/** A small real-shaped answer: Fulda, Sat 21.11.2026, 09:00, up to 2 h - three towns. */

const town = (id: string, name: string, minutes: number, score: number, rain: number, lat: number): Destination => ({
  id,
  name,
  kind: 'town',
  minutes,
  transfers: 0,
  arrival: `2026-11-21T08:${String(minutes).padStart(2, '0')}:00Z`,
  station: { id: `s-${id}`, name: `${name} Bahnhof`, lat, lon: 9.7 },
  center: { lat, lon: 9.7 },
  weather: { date: '2026-11-21', code: 61, tempMax: 7.2, tempMin: 1.2, precipitationProbability: rain, precipitationMm: 1, windMaxKmh: 12, sunshineHours: 8 },
  places: [
    { id: `otm:${id}-m`, name: `${name} Museum`, category: 'museum', rating: 3, distance: 200, lat, lon: 9.71 },
    { id: `otm:${id}-c`, name: `Café ${name}`, category: 'food', rating: 1, distance: 100, lat, lon: 9.69 },
    { id: `otm:${id}-k`, name: `${name} Kirche`, category: 'architecture', rating: 2, distance: 300, lat, lon: 9.72 },
  ],
  sightsTotal: 6,
  score: { total: score, parts: { trip: 0.7, weather: 0.6, places: 0.5 }, weatherUnknown: false, placesUnknown: false },
})

export const destinations: Destinations = {
  origin: { id: 'f', name: 'Fulda', lat: 50.55, lon: 9.68, locality: 'Fulda' },
  departure: '2026-11-21T08:00:00Z',
  date: '2026-11-21',
  maxMinutes: 120,
  cities: [
    town('hunfeld', 'Hünfeld', 35, 62.8, 39, 50.67),
    town('schluchtern', 'Schlüchtern', 42, 61.7, 49, 50.35),
    town('steinau', 'Steinau an der Straße', 47, 60.4, 49, 50.31),
    town('bebra', 'Bebra', 55, 50.1, 20, 50.97),
  ],
  enrichment: { weather: 'ok', weatherSource: 'open-meteo', placesSource: 'opentripmap', placesFailures: 0, placesSkipped: 0, placesPaused: false },
}

export const verdict: VerdictAnswer = {
  verdict: {
    top: [
      { id: 'hunfeld', reason: 'Найкоротша поїздка і музей.' },
      { id: 'schluchtern', reason: 'Трохи далі, гарна архітектура.' },
      { id: 'steinau', reason: 'Замок і природа.' },
    ],
    comparison: 'Hünfeld найближче, Schlüchtern і Steinau трохи далі.',
    warnings: [{ text: 'Перевір поїзд назад увечері.' }],
    quest: {
      cityId: 'hunfeld',
      title: 'День у Hünfeld',
      steps: [
        { time: '09:35', title: 'Прибуття', description: 'Вийди з вокзалу.', xp: 10 },
        { time: '10:00', title: 'Музей', placeId: 'otm:hunfeld-m', description: 'Зазирни до музею.', xp: 20 },
        { time: '12:30', title: 'Кава', placeId: 'otm:hunfeld-c', description: 'Перерва на каву.', xp: 15 },
      ],
    },
    character: { mood: 'excited', line: 'Готові до пригод? Ходімо!' },
  },
  fallback: ['hunfeld', 'schluchtern', 'steinau', 'bebra'],
  ai: { status: 'ok', provider: 'groq', model: 'm', problems: [] },
}

/** A fetch that answers the app's API calls from the fixtures. */
export function fakeApi(over: { verdict?: VerdictAnswer; destinations?: Destinations | 'fail' } = {}) {
  return async (input: string | URL | Request) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.startsWith('/api/stations')) return json({ ok: true, stations: [{ id: 'f', name: 'Fulda', lat: 50.55, lon: 9.68 }] })
    if (url.startsWith('/api/destinations')) {
      if (over.destinations === 'fail') return json({ ok: false, error: { code: 'upstream_unavailable', message: 'down' } }, 502)
      return json({ ok: true, ...(over.destinations ?? destinations) })
    }
    if (url.startsWith('/api/verdict')) return json({ ok: true, ...(over.verdict ?? verdict) })
    return json({ ok: false, error: { code: 'not_found', message: url } }, 404)
  }
}
