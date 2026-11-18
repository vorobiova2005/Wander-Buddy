// Fixes after the step 06 review: allowed countries, the search limit, honest failure counting, same-name towns.
import { describe, expect, it, vi } from 'vitest'
import { BusyError } from './cache.js'
import { ReachabilityService } from './reachability.js'
import type { Coordinates, Locality, LocalityResolver, ReachableStop, TransitProvider } from './transit/types.js'

const ORIGIN = { id: 'o', name: 'Fulda', lat: 50.5549, lon: 9.6842 }
const query = { origin: ORIGIN, departure: new Date('2026-11-21T08:00:00Z'), maxMinutes: 120 }

const stop = (id: string, lat: number, lon: number, minutes: number): ReachableStop => ({
  id,
  name: id,
  lat,
  lon,
  minutes,
  vehicles: 1,
  arrival: 'x',
  rail: true,
})

function setup(stops: ReachableStop[], localityAt: (p: Coordinates) => Promise<Locality | null>) {
  const transit: TransitProvider = {
    name: 'fake',
    findStations: vi.fn(async (text: string) => (text.trim().toLowerCase() === 'fulda' ? [ORIGIN] : [])),
    reachableStops: vi.fn(async () => stops),
  }
  const locality: LocalityResolver = { name: 'fake', localityAt: vi.fn(localityAt) }
  return { transit, locality }
}

const isOrigin = (p: Coordinates) => p.lat === ORIGIN.lat && p.lon === ORIGIN.lon
const fuldaOrigin = async (p: Coordinates): Promise<Locality | null> =>
  isOrigin(p) ? { name: 'Fulda', kind: 'town' } : { name: 'Alpha', kind: 'town' }

describe('isAllowedPoint', () => {
  const service = (countries?: string[]) =>
    new ReachabilityService({ ...setup([], fuldaOrigin), countries })

  it.each([
    ['Fulda', { lat: 50.55, lon: 9.68 }, true],
    ['Flensburg (north edge)', { lat: 54.78, lon: 9.43 }, true],
    ['New York', { lat: 40.75, lon: -73.99 }, false],
    ['Madrid', { lat: 40.42, lon: -3.7 }, false],
    ['0,0', { lat: 0, lon: 0 }, false],
  ])('with the default countries (DE): %s → %s', (_name, point, allowed) => {
    expect(service().isAllowedPoint(point)).toBe(allowed)
  })

  it('checks the countries given, case-insensitively', () => {
    const vienna = { lat: 48.21, lon: 16.37 }
    expect(service().isAllowedPoint(vienna)).toBe(false)
    expect(service(['de', 'at']).isAllowedPoint(vienna)).toBe(true)
  })

  it('does not check a country without a box (no false refusals)', () => {
    expect(service(['DE', 'XX']).isAllowedPoint({ lat: 40.75, lon: -73.99 })).toBe(true)
  })
})

describe('search limit', () => {
  it('refuses a second new search in the same minute with BusyError, allows it after the minute', async () => {
    let now = 0
    const { transit, locality } = setup([stop('A', 50.1, 9.5, 30)], fuldaOrigin)
    const service = new ReachabilityService({ transit, locality, searchesPerMinute: 1, now: () => now })
    await service.reachable(query)
    const other = { ...query, maxMinutes: 90 }
    await expect(service.reachable(other)).rejects.toBeInstanceOf(BusyError)
    expect(transit.reachableStops).toHaveBeenCalledTimes(1)

    now = 60_000
    expect((await service.reachable(other)).cached).toBe(false)
    expect(transit.reachableStops).toHaveBeenCalledTimes(2)
  })

  it('serves a cached repeat even when the limit is used up', async () => {
    const { transit, locality } = setup([stop('A', 50.1, 9.5, 30)], fuldaOrigin)
    const service = new ReachabilityService({ transit, locality, searchesPerMinute: 1, now: () => 0 })
    await service.reachable(query)
    expect((await service.reachable(query)).cached).toBe(true)
  })

  it('lets an identical concurrent search join the running one instead of counting it', async () => {
    const { transit, locality } = setup([stop('A', 50.1, 9.5, 30)], fuldaOrigin)
    const service = new ReachabilityService({ transit, locality, searchesPerMinute: 1, now: () => 0 })
    const [a, b] = await Promise.all([service.reachable(query), service.reachable(query)])
    expect(a.result).toBe(b.result)
    expect(transit.reachableStops).toHaveBeenCalledTimes(1)
  })
})

describe('findStations', () => {
  it('asks the provider once for the same letters', async () => {
    const { transit, locality } = setup([], fuldaOrigin)
    const service = new ReachabilityService({ transit, locality })
    expect(await service.findStations('Fulda')).toEqual([ORIGIN])
    expect(await service.findStations(' fulda ')).toEqual([ORIGIN])
    expect(transit.findStations).toHaveBeenCalledTimes(1)
  })

  it('caches an empty answer too', async () => {
    const { transit, locality } = setup([], fuldaOrigin)
    const service = new ReachabilityService({ transit, locality })
    await service.findStations('Atlantis')
    await service.findStations('Atlantis')
    expect(transit.findStations).toHaveBeenCalledTimes(1)
  })
})

describe('failure counting', () => {
  it('counts a shared failing station lookup as a gap in every search that waited for it', async () => {
    const station = stop('A', 50.1, 9.5, 30)
    const { transit, locality } = setup([station], async (p) => {
      if (isOrigin(p)) return { name: 'Fulda', kind: 'town' }
      await new Promise((r) => setTimeout(r, 10)) // still running when the second search arrives
      throw new Error('429')
    })
    const service = new ReachabilityService({ transit, locality })
    const later = { ...query, departure: new Date('2026-11-21T09:00:00Z') }
    const [a, b] = await Promise.all([service.reachable(query), service.reachable(later)])

    const stationLookups = vi.mocked(locality.localityAt).mock.calls.filter(([p]) => !isOrigin(p))
    expect(stationLookups).toHaveLength(1) // shared
    expect(a.result.stats.localityFailures).toBe(1)
    expect(b.result.stats.localityFailures).toBe(1)
    expect(a.result.cities).toEqual([])
    expect(b.result.cities).toEqual([])
  })
})

describe('towns with the same name', () => {
  it('keeps two towns named "Neuhof" ~100 km apart as two cities with different ids', async () => {
    const { transit, locality } = setup(
      [stop('Neuhof (Fulda)', 50.45, 9.61, 20), stop('Neuhof (north)', 51.35, 9.61, 90)],
      async (p) => (isOrigin(p) ? { name: 'Fulda', kind: 'town' } : { name: 'Neuhof', kind: 'village' }),
    )
    const { result } = await new ReachabilityService({ transit, locality }).reachable(query)
    // Without a town centre the station stands in for it; the id carries that place, not the order of arrival.
    expect(result.cities.map((c) => [c.id, c.name, c.station.name])).toEqual([
      ['neuhof-5045-961', 'Neuhof', 'Neuhof (Fulda)'],
      ['neuhof-5135-961', 'Neuhof', 'Neuhof (north)'],
    ])
  })

  it('gives each "Neuhof" the same id whichever is reached first', async () => {
    const ids = async (fuldaMinutes: number, northMinutes: number) => {
      const { transit, locality } = setup(
        [stop('Neuhof (Fulda)', 50.45, 9.61, fuldaMinutes), stop('Neuhof (north)', 51.35, 9.61, northMinutes)],
        async (p) => (isOrigin(p) ? { name: 'Fulda', kind: 'town' } : { name: 'Neuhof', kind: 'village' }),
      )
      const { result } = await new ReachabilityService({ transit, locality }).reachable(query)
      return Object.fromEntries(result.cities.map((c) => [c.station.name, c.id]))
    }
    expect(await ids(20, 90)).toEqual(await ids(90, 20))
  })

  it('keeps the plain slug for a name that is unique in the answer', async () => {
    const { transit, locality } = setup([stop('Alpha Bf', 50.67, 9.77, 20)], fuldaOrigin)
    const { result } = await new ReachabilityService({ transit, locality }).reachable(query)
    expect(result.cities.map((c) => c.id)).toEqual(['alpha'])
  })

  it('keeps two stations of one town 2 km apart as one city, the faster one', async () => {
    const { transit, locality } = setup(
      [stop('Alpha Nord', 50.1, 9.5, 40), stop('Alpha Süd', 50.118, 9.5, 35)],
      fuldaOrigin,
    )
    const { result } = await new ReachabilityService({ transit, locality }).reachable(query)
    expect(result.cities.map((c) => [c.id, c.station.name, c.minutes])).toEqual([['alpha', 'Alpha Süd', 35]])
  })

  it('leaves out the origin town but keeps a far town with the same name', async () => {
    const { transit, locality } = setup(
      [stop('Fulda Galerie', 50.56, 9.69, 5), stop('Fulda far away', 50.1, 9.5, 60)],
      async () => ({ name: 'Fulda', kind: 'town' }),
    )
    const { result } = await new ReachabilityService({ transit, locality }).reachable(query)
    expect(result.origin.locality).toBe('Fulda')
    expect(result.cities.map((c) => [c.id, c.station.name])).toEqual([['fulda', 'Fulda far away']])
  })
})
