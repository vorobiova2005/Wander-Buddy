import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { ReachabilityService } from './reachability.js'
import { UpstreamError, type LocalityResolver, type TransitProvider } from './transit/types.js'
import { VERSION_FILE } from './version.js'

function appWith(transit: Partial<TransitProvider>) {
  const provider: TransitProvider = {
    name: 'fake',
    findStations: async (text) => (text === 'Fulda' ? [{ id: 'f', name: 'Fulda', lat: 50.55, lon: 9.68 }] : []),
    reachableStops: async () => [
      { id: 's', name: 'Schlüchtern', lat: 50.34, lon: 9.51, minutes: 42, vehicles: 1, arrival: 'x', rail: true },
      { id: 'e', name: 'Eichenzell', lat: 50.5, lon: 9.7, minutes: 15, vehicles: 1, arrival: 'x', rail: true },
    ],
    ...transit,
  }
  const locality: LocalityResolver = {
    name: 'fake',
    localityAt: async (p) =>
      p.lat === 50.34 ? { name: 'Schlüchtern', kind: 'town' } : p.lat === 50.5 ? { name: 'Eichenzell', kind: 'village' } : null,
  }
  // A fixed "today": the searched days below stay within the allowed range whenever the tests run.
  return createApp({ reachability: new ReachabilityService({ transit: provider, locality }), today: () => '2026-11-18' })
}

describe('GET /api/reachable', () => {
  it('returns towns, hides villages unless asked, and marks the second answer as cached', async () => {
    const app = appWith({})
    const first = await app.request('/api/reachable?from=Fulda&maxMinutes=120&date=2026-11-21&time=09:00')
    expect(first.status).toBe(200)
    expect(first.headers.get('x-cache')).toBe('MISS')
    const body = await first.json()
    expect(body.provider).toBe('fake')
    expect(body.departure).toBe('2026-11-21T08:00:00.000Z')
    expect(body.cities.map((c: { name: string }) => c.name)).toEqual(['Schlüchtern'])

    const second = await app.request('/api/reachable?from=Fulda&maxMinutes=120&date=2026-11-21&time=09:00&villages=true')
    expect(second.headers.get('x-cache')).toBe('HIT')
    expect((await second.json()).cities.map((c: { name: string }) => c.name)).toEqual(['Eichenzell', 'Schlüchtern'])
  })

  it('accepts coordinates instead of a name', async () => {
    const res = await appWith({}).request('/api/reachable?lat=50.55&lon=9.68&date=2026-11-21')
    expect(res.status).toBe(200)
  })

  it.each([
    ['/api/reachable', 'bad_request'],
    ['/api/reachable?from=Fulda&maxMinutes=500', 'bad_request'],
    ['/api/reachable?from=Fulda&date=21.11.2026', 'bad_request'],
    ['/api/reachable?lat=200&lon=9', 'bad_request'],
  ])('rejects %s', async (url, code) => {
    const res = await appWith({}).request(url)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe(code)
  })

  it('answers 404 origin_not_found for an unknown place', async () => {
    const res = await appWith({}).request('/api/reachable?from=Atlantis')
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('origin_not_found')
  })

  it('answers 502 upstream_unavailable when the data source fails', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await appWith({
      reachableStops: async () => {
        throw new UpstreamError('fake', 'down')
      },
    }).request('/api/reachable?from=Fulda')
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('upstream_unavailable')
    spy.mockRestore()
  })
})

describe('GET /api/stations', () => {
  it('finds stations by name', async () => {
    const res = await appWith({}).request('/api/stations?q=Fulda')
    expect((await res.json()).stations[0].name).toBe('Fulda')
  })

  it('needs at least two characters', async () => {
    expect((await appWith({}).request('/api/stations?q=F')).status).toBe(400)
  })
})

describe('api', () => {
  const app = createApp()

  it('GET /api/health answers ok with the version from the VERSION file', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: readFileSync(VERSION_FILE, 'utf-8').trim() })
  })

  it('unknown API route answers with the JSON error shape', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })

  it('allows the production site origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://wander-buddy.zebaro.dev' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://wander-buddy.zebaro.dev')
  })

  it('does not allow a foreign origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
