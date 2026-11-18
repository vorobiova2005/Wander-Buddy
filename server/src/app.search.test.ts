// Validation of the shared search parameters and the "busy" answer (fixes after the step 06 review).
import { describe, expect, it, vi } from 'vitest'
import { createApp, MAX_QUERY_LENGTH } from './app.js'
import { BusyError } from './cache.js'
import { ReachabilityService } from './reachability.js'
import { addDays } from './time.js'
import type { LocalityResolver, TransitProvider } from './transit/types.js'
import type { VerdictService } from './verdict.js'

const TODAY = '2026-11-18'

function setup(options: { searchesPerMinute?: number } = {}) {
  const transit: TransitProvider = {
    name: 'fake',
    findStations: vi.fn(async (text: string) => (text === 'Fulda' ? [{ id: 'f', name: 'Fulda', lat: 50.55, lon: 9.68 }] : [])),
    reachableStops: vi.fn(async () => [
      { id: 's', name: 'Schlüchtern', lat: 50.34, lon: 9.51, minutes: 42, vehicles: 1, arrival: 'x', rail: true },
    ]),
  }
  const locality: LocalityResolver = {
    name: 'fake',
    localityAt: vi.fn(async (p) => (p.lat === 50.34 ? { name: 'Schlüchtern', kind: 'town' as const } : { name: 'Fulda', kind: 'town' as const })),
  }
  const reachability = new ReachabilityService({ transit, locality, searchesPerMinute: options.searchesPerMinute })
  const app = createApp({ reachability, today: () => TODAY })
  return { app, transit, locality }
}

async function errorOf(res: Response) {
  return { status: res.status, code: (await res.json()).error?.code }
}

describe('search parameters - coordinates', () => {
  it.each([
    ['both empty', 'lat=&lon='],
    ['empty lon', 'lat=50.55&lon='],
    ['blank lat', 'lat=%20&lon=9.68'],
    ['only lat', 'lat=50.55'],
  ])('rejects %s as bad_request, never as a search at 0,0', async (_name, params) => {
    const { app, transit } = setup()
    expect(await errorOf(await app.request(`/api/reachable?${params}`))).toEqual({ status: 400, code: 'bad_request' })
    expect(transit.reachableStops).not.toHaveBeenCalled()
  })

  it('refuses a point outside the supported countries (New York) without asking the data source', async () => {
    const { app, transit, locality } = setup()
    expect(await errorOf(await app.request('/api/reachable?lat=40.75&lon=-73.99'))).toEqual({
      status: 400,
      code: 'origin_outside',
    })
    expect(transit.reachableStops).not.toHaveBeenCalled()
    expect(locality.localityAt).not.toHaveBeenCalled()
  })

  it('accepts a point in Germany', async () => {
    const { app, transit } = setup()
    const res = await app.request('/api/reachable?lat=50.55&lon=9.68')
    expect(res.status).toBe(200)
    expect(transit.reachableStops).toHaveBeenCalledTimes(1)
  })
})

describe('search parameters - the trip day', () => {
  it.each([
    ['yesterday', addDays(TODAY, -1), 200],
    ['today', TODAY, 200],
    ['60 days ahead', addDays(TODAY, 60), 200],
  ])('accepts %s', async (_name, date, status) => {
    const res = await setup().app.request(`/api/reachable?from=Fulda&date=${date}`)
    expect(res.status).toBe(status)
  })

  it.each([
    ['2 days ago', addDays(TODAY, -2)],
    ['61 days ahead', addDays(TODAY, 61)],
    ['a year ago', '2025-11-18'],
  ])('rejects %s with date_out_of_range', async (_name, date) => {
    const { app, transit } = setup()
    expect(await errorOf(await app.request(`/api/reachable?from=Fulda&date=${date}`))).toEqual({
      status: 400,
      code: 'date_out_of_range',
    })
    expect(transit.reachableStops).not.toHaveBeenCalled()
  })

  it('takes the year boundary into account (today+60 from 18.11 is 2027-01-17)', () => {
    expect(addDays(TODAY, 60)).toBe('2027-01-17')
  })
})

describe('GET /api/stations - query length', () => {
  it(`accepts ${MAX_QUERY_LENGTH} characters and rejects ${MAX_QUERY_LENGTH + 1}`, async () => {
    const { app, transit } = setup()
    expect((await app.request(`/api/stations?q=${'a'.repeat(MAX_QUERY_LENGTH)}`)).status).toBe(200)
    const res = await app.request(`/api/stations?q=${'a'.repeat(MAX_QUERY_LENGTH + 1)}`)
    expect(await errorOf(res)).toEqual({ status: 400, code: 'bad_request' })
    expect(transit.findStations).toHaveBeenCalledTimes(1)
  })
})

describe('busy server', () => {
  it('answers 429 busy when a new search is over the limit; a repeat is still served from the cache', async () => {
    const { app } = setup({ searchesPerMinute: 1 })
    expect((await app.request('/api/reachable?from=Fulda&maxMinutes=120')).status).toBe(200)

    const res = await app.request('/api/reachable?from=Fulda&maxMinutes=90')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'busy', message: expect.any(String) } })

    const repeat = await app.request('/api/reachable?from=Fulda&maxMinutes=120')
    expect(repeat.status).toBe(200)
    expect(repeat.headers.get('x-cache')).toBe('HIT')
  })

  it('maps a BusyError from any service to 429 JSON', async () => {
    const { transit, locality } = setup()
    const reachability = new ReachabilityService({ transit, locality })
    const verdicts = {
      verdict: async () => {
        throw new BusyError()
      },
    } as unknown as VerdictService
    const app = createApp({ reachability, verdicts, today: () => TODAY })
    const res = await app.request('/api/verdict?from=Fulda')
    expect(res.status).toBe(429)
    expect((await res.json()).error.code).toBe('busy')
  })
})
