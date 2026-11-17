import { describe, expect, it, vi } from 'vitest'
import { municipalityOf, Transitous } from './transitous.js'
import { UpstreamError } from './types.js'

// Shapes taken from real Transitous answers (17.11.2026), trimmed to the fields used.
const fullda = {
  id: 'de-DELFI_de:06631:11049',
  name: 'Fulda',
  type: 'STOP',
  lat: 50.554905,
  lon: 9.684169,
  areas: [
    { name: 'Landkreis Fulda', adminLevel: 6 },
    { name: 'Fulda', adminLevel: 8 },
    { name: 'Nordend', adminLevel: 10 },
  ],
}

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input))
    const body = routes[url.pathname]
    if (body === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(typeof body === 'function' ? body(url) : body), { status: 200 })
  })
}

const client = (f: ReturnType<typeof fakeFetch>) => new Transitous({ userAgent: 'Test/1.0', fetch: f as typeof fetch })

describe('Transitous', () => {
  it('sends the User-Agent the usage policy asks for', async () => {
    const f = fakeFetch({ '/api/v1/geocode': [fullda] })
    await client(f).findStations('Fulda', 1)
    const init = f.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('Test/1.0')
  })

  it('maps geocode matches to stations with their municipality', async () => {
    const stations = await client(fakeFetch({ '/api/v1/geocode': [fullda] })).findStations('Fulda', 1)
    expect(stations).toEqual([{ id: fullda.id, name: 'Fulda', lat: 50.554905, lon: 9.684169, area: 'Fulda' }])
  })

  it('asks one-to-all for regional modes only and maps the answer', async () => {
    const f = fakeFetch({
      '/api/v6/one-to-all': {
        one: {},
        all: [
          {
            place: { name: 'Kassel Hbf', stopId: 'k', lat: 51.3, lon: 9.4, arrival: '2026-11-21T09:52:00Z', modes: ['REGIONAL_RAIL', 'BUS'] },
            duration: 112,
            k: 1,
          },
          { place: { name: 'Marktplatz', lat: 50.1, lon: 9.1, modes: ['BUS'] }, duration: 30, k: 2 },
        ],
      },
    })
    const stops = await client(f).reachableStops({
      origin: { lat: 50.55, lon: 9.68 },
      departure: new Date('2026-11-21T08:00:00Z'),
      maxMinutes: 120,
    })
    const url = new URL(String(f.mock.calls[0][0]))
    expect(url.searchParams.get('transitModes')).not.toMatch(/HIGHSPEED_RAIL|LONG_DISTANCE/)
    expect(url.searchParams.get('time')).toBe('2026-11-21T08:00:00.000Z')
    expect(stops.map((s) => [s.name, s.minutes, s.vehicles, s.rail])).toEqual([
      ['Kassel Hbf', 112, 1, true],
      ['Marktplatz', 30, 2, false],
    ])
  })

  it('tells a town from a village through the OSM place category', async () => {
    const station = { ...fullda, areas: [{ name: 'Main-Kinzig-Kreis', adminLevel: 6 }, { name: 'Schlüchtern', adminLevel: 8 }] }
    const f = fakeFetch({
      '/api/v1/reverse-geocode': [station],
      '/api/v1/geocode': [
        { name: 'Schlüchtern', category: 'town', areas: [{ name: 'Schlüchtern', adminLevel: 8 }] },
      ],
    })
    expect(await client(f).localityAt({ lat: 50.34, lon: 9.51 })).toEqual({ name: 'Schlüchtern', kind: 'town' })
  })

  it('does not take a same-named place elsewhere for the town (Gießen vs Giesen)', async () => {
    const station = { ...fullda, areas: [{ name: 'Gießen', adminLevel: 8 }] }
    const f = fakeFetch({
      '/api/v1/reverse-geocode': [station],
      '/api/v1/geocode': [
        { name: 'Giesen', category: 'town', areas: [{ name: 'Giesen', adminLevel: 8 }] },
        { name: 'Gießen', category: 'municipality', areas: [{ name: 'Gießen', adminLevel: 8 }] },
      ],
    })
    expect(await client(f).localityAt({ lat: 50.58, lon: 8.66 })).toEqual({ name: 'Gießen', kind: 'village' })
  })

  it('treats a city that is its own district as a city and finds its centre', async () => {
    const f = fakeFetch({
      '/api/v1/reverse-geocode': [{ ...fullda, areas: [{ name: 'Kassel', adminLevel: 6 }] }],
      '/api/v1/geocode': [{ name: 'Kassel', category: 'place_6', lat: 51.3157, lon: 9.498, areas: [{ name: 'Kassel', adminLevel: 6 }] }],
    })
    expect(await client(f).localityAt({ lat: 51.3, lon: 9.4 })).toEqual({
      name: 'Kassel',
      kind: 'city',
      center: { lat: 51.3157, lon: 9.498 },
    })
  })

  it('still knows a city that is its own district when the centre lookup fails', async () => {
    const f = vi.fn(async (input: string | URL | Request) =>
      new URL(String(input)).pathname === '/api/v1/reverse-geocode'
        ? new Response(JSON.stringify([{ ...fullda, areas: [{ name: 'Kassel', adminLevel: 6 }] }]))
        : new Response('busy', { status: 503 }),
    )
    expect(await client(f as unknown as ReturnType<typeof fakeFetch>).localityAt({ lat: 51.3, lon: 9.4 })).toEqual({
      name: 'Kassel',
      kind: 'city',
    })
  })

  it('gives the town centre, not the station, so a suburban station still leads to the old town', async () => {
    // Eisenach: the fastest station is in the suburb Hörschel; the town's place node is the centre.
    const f = fakeFetch({
      '/api/v1/reverse-geocode': [{ ...fullda, areas: [{ name: 'Wartburgkreis', adminLevel: 6 }, { name: 'Eisenach', adminLevel: 8 }] }],
      '/api/v1/geocode': [
        { name: 'Eisenach', category: 'municipality', lat: 50.97, lon: 10.3, areas: [{ name: 'Eisenach', adminLevel: 8 }] },
        { name: 'Eisenach', category: 'town', lat: 50.9747, lon: 10.3194, areas: [{ name: 'Eisenach', adminLevel: 8 }] },
      ],
    })
    const town = await client(f).localityAt({ lat: 50.986, lon: 10.193 })
    expect(town).toEqual({ name: 'Eisenach', kind: 'town', center: { lat: 50.9747, lon: 10.3194 } })
  })

  it('turns an HTTP error into an UpstreamError', async () => {
    await expect(client(fakeFetch({})).findStations('x', 1)).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('municipalityOf', () => {
  it('prefers admin level 8, accepts level 6 only for a city that is its own district', () => {
    expect(municipalityOf(fullda.areas)?.name).toBe('Fulda')
    expect(municipalityOf([{ name: 'Kassel', adminLevel: 6 }])?.name).toBe('Kassel')
    expect(municipalityOf([{ name: 'Landkreis Fulda', adminLevel: 6 }])).toBeNull()
    expect(municipalityOf([{ name: 'Main-Kinzig-Kreis', adminLevel: 6 }])).toBeNull()
    expect(municipalityOf(undefined)).toBeNull()
  })
})

describe('Transitous broken answers', () => {
  it('turns a body that is not JSON into an UpstreamError (502, not 500)', async () => {
    const f = vi.fn(async () => new Response('<html>busy</html>', { status: 200 }))
    await expect(
      new Transitous({ userAgent: 'T', fetch: f as unknown as typeof fetch }).findStations('x', 1),
    ).rejects.toBeInstanceOf(UpstreamError)
  })
})
