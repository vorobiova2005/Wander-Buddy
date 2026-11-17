import { describe, expect, it, vi } from 'vitest'
import { UpstreamError } from '../transit/types.js'
import { OpenMeteo } from './openmeteo.js'
import { categoryOf, OpenTripMap, ratingOf } from './opentripmap.js'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('OpenMeteo', () => {
  // Shape of a real answer (17.11.2026) for two points.
  const day = (code: number, max: number) => ({
    daily: {
      time: ['2026-11-21'],
      weather_code: [code],
      temperature_2m_max: [max],
      temperature_2m_min: [1.7],
      precipitation_probability_max: [49],
      precipitation_sum: [5.9],
      wind_speed_10m_max: [15.3],
      sunshine_duration: [24339.68],
    },
  })

  it('asks for all points in one call and keeps their order', async () => {
    const f = vi.fn(async () => json([day(61, 8), day(45, 6.5)]))
    const om = new OpenMeteo({ userAgent: 'T', fetch: f as unknown as typeof fetch })
    const [a, b] = await om.daily(
      [
        { lat: 50.34, lon: 9.51 },
        { lat: 51.31, lon: 9.48 },
      ],
      '2026-11-21',
    )
    expect(f).toHaveBeenCalledTimes(1)
    const url = new URL(String((f.mock.calls[0] as unknown[])[0]))
    expect(url.searchParams.get('latitude')).toBe('50.3400,51.3100')
    expect(url.searchParams.get('start_date')).toBe('2026-11-21')
    expect(a).toEqual({
      date: '2026-11-21',
      code: 61,
      tempMax: 8,
      tempMin: 1.7,
      precipitationProbability: 49,
      precipitationMm: 5.9,
      windMaxKmh: 15.3,
      sunshineHours: 6.8,
    })
    expect(b?.code).toBe(45)
  })

  it('accepts the single-object answer Open-Meteo gives for one point', async () => {
    const f = vi.fn(async () => json(day(0, 12)))
    const [w] = await new OpenMeteo({ userAgent: 'T', fetch: f as unknown as typeof fetch }).daily([{ lat: 1, lon: 2 }], '2026-11-21')
    expect(w?.code).toBe(0)
  })

  it('splits many points into batches', async () => {
    const f = vi.fn(async (input: string | URL | Request) => {
      const n = new URL(String(input)).searchParams.get('latitude')!.split(',').length
      return json(Array.from({ length: n }, () => day(3, 5)))
    })
    const points = Array.from({ length: OpenMeteo.BATCH + 5 }, (_, i) => ({ lat: 50 + i / 100, lon: 9 }))
    const out = await new OpenMeteo({ userAgent: 'T', fetch: f as unknown as typeof fetch }).daily(points, '2026-11-21')
    expect(f).toHaveBeenCalledTimes(2)
    expect(out).toHaveLength(points.length)
  })

  it('turns an HTTP error into an UpstreamError', async () => {
    const f = vi.fn(async () => json({ error: true, reason: 'out of range' }, 400))
    await expect(
      new OpenMeteo({ userAgent: 'T', fetch: f as unknown as typeof fetch }).daily([{ lat: 1, lon: 2 }], '2026-11-21'),
    ).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('OpenTripMap', () => {
  const feature = (xid: string, name: string, kinds: string, rate: number, dist: number) => ({
    xid,
    name,
    kinds,
    rate,
    dist,
    point: { lat: 50, lon: 9 },
  })

  const client = (f: ReturnType<typeof vi.fn>) =>
    new OpenTripMap({ apiKey: 'k', userAgent: 'T', fetch: f as unknown as typeof fetch, minIntervalMs: 0, retryAfterMs: 0 })

  it('returns sights then cafés, named and without duplicates of one object', async () => {
    const f = vi.fn(async (input: string | URL | Request) => {
      const kinds = new URL(String(input)).searchParams.get('kinds')
      return kinds === 'cafes'
        ? json([feature('C1', 'Café Mozart', 'foods,cafes', 1, 120)])
        : json([
            feature('A', 'Main-Weser-Bahn', 'architecture,bridges', 7, 300),
            feature('B', 'Main-Weser-Bahn', 'architecture,bridges', 7, 500),
            feature('M', 'Brüder Grimm-Museum', 'cultural,museums', 7, 900),
            feature('X', '', 'historic', 3, 50),
          ])
    })
    const places = await client(f).near({ lat: 51.3, lon: 9.5 }, 3000)
    expect(places.map((p) => [p.name, p.category, p.rating])).toEqual([
      ['Main-Weser-Bahn', 'architecture', 3],
      ['Brüder Grimm-Museum', 'museum', 3],
      ['Café Mozart', 'food', 1],
    ])
    expect(places[0].id).toBe('otm:A')
  })

  it('retries a 429 and gives up with an UpstreamError if it stays', async () => {
    let calls = 0
    const flaky = vi.fn(async () => (++calls === 1 ? json({}, 429) : json([])))
    await expect(client(flaky).near({ lat: 1, lon: 2 }, 1000)).resolves.toEqual([])

    const limited = vi.fn(async () => json({}, 429))
    await expect(client(limited).near({ lat: 1, lon: 2 }, 1000)).rejects.toBeInstanceOf(UpstreamError)
    // At least one list went through 1 call + 2 retries before giving up.
    expect(limited.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('spaces requests to stay under the plan limit', async () => {
    const times: number[] = []
    const f = vi.fn(async () => {
      times.push(Date.now())
      return json([])
    })
    const otm = new OpenTripMap({ apiKey: 'k', userAgent: 'T', fetch: f as unknown as typeof fetch, minIntervalMs: 100 })
    await Promise.all([otm.near({ lat: 1, lon: 2 }, 1000), otm.near({ lat: 3, lon: 4 }, 1000)])
    const gaps = times.slice(1).map((t, i) => t - times[i])
    // 4 requests, ~100 ms apart (timers on Windows can fire up to ~16 ms early).
    expect(times).toHaveLength(4)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(80)
  })

  it('maps OpenTripMap kinds and ratings', () => {
    expect(categoryOf('cultural,museums,interesting_places')).toBe('museum')
    expect(categoryOf('historic,castles,fortifications')).toBe('historic')
    expect(categoryOf('natural,nature_reserves')).toBe('nature')
    expect(categoryOf('religion,churches,architecture')).toBe('architecture')
    expect(categoryOf('foods,cafes')).toBe('food')
    expect(categoryOf('theatres_and_entertainments,cultural')).toBe('culture')
    expect(categoryOf('amusements')).toBe('other')
    expect([ratingOf(1), ratingOf(3), ratingOf(7), ratingOf('2h'), ratingOf(undefined)]).toEqual([1, 3, 3, 2, 0])
  })
})
