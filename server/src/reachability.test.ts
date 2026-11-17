import { describe, expect, it, vi } from 'vitest'
import { PersistentMap } from './cache.js'
import { mergeNearbyStops, namesMatch, ReachabilityService, slugify } from './reachability.js'
import type { Coordinates, Locality, LocalityResolver, ReachableStop, TransitProvider } from './transit/types.js'

// A fake data source: the service must work with any TransitProvider, not only Transitous.
const stop = (id: string, lat: number, lon: number, minutes: number, vehicles = 1, rail = true): ReachableStop => ({
  id,
  name: id,
  lat,
  lon,
  minutes,
  vehicles,
  arrival: '2026-11-21T09:00:00Z',
  rail,
})

const FULDA = { id: 'fulda', name: 'Fulda', lat: 50.5549, lon: 9.6842 }

const towns: Record<string, Locality> = {
  '50.555,9.684': { name: 'Fulda', kind: 'town' },
  '51.318,9.489': { name: 'Kassel', kind: 'city' },
  '51.313,9.447': { name: 'Kassel', kind: 'city' },
  '50.341,9.510': { name: 'Schlüchtern', kind: 'town' },
  '50.500,9.700': { name: 'Eichenzell', kind: 'village' },
}

function fakes(stops: ReachableStop[]) {
  const transit: TransitProvider = {
    name: 'fake',
    findStations: vi.fn(async (text: string) => (text === 'Fulda' ? [FULDA] : [])),
    reachableStops: vi.fn(async () => stops),
  }
  const locality: LocalityResolver = {
    name: 'fake',
    localityAt: vi.fn(async (p: Coordinates) => towns[`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`] ?? null),
  }
  return { transit, locality }
}

const query = { origin: FULDA, departure: new Date('2026-11-21T08:00:00Z'), maxMinutes: 120 }

describe('ReachabilityService', () => {
  it('groups stations into towns, keeps the fastest and counts transfers', async () => {
    const { transit, locality } = fakes([
      stop('Kassel Hbf', 51.3183, 9.4895, 112, 1),
      stop('Kassel-Wilhelmshöhe', 51.3131, 9.4468, 105, 2),
      stop('Schlüchtern', 50.3412, 9.51, 42, 1),
      stop('Eichenzell', 50.5, 9.7, 15, 1),
    ])
    const service = new ReachabilityService({ transit, locality })
    const { result, cached } = await service.reachable(query)

    expect(cached).toBe(false)
    expect(result.cities.map((c) => [c.name, c.minutes, c.transfers, c.kind])).toEqual([
      ['Eichenzell', 15, 0, 'village'],
      ['Schlüchtern', 42, 0, 'town'],
      ['Kassel', 105, 1, 'city'],
    ])
    expect(result.cities[2].station.name).toBe('Kassel-Wilhelmshöhe')
    expect(result.origin.locality).toBe('Fulda')
  })

  it('leaves out the origin town, bus-only stops and stops with an unknown town', async () => {
    const { transit, locality } = fakes([
      stop('Fulda Süd', 50.5549, 9.6842, 5),
      stop('Some bus stop', 50.3412, 9.51, 20, 1, false),
      stop('Nowhere', 10, 10, 30),
    ])
    const { result } = await new ReachabilityService({ transit, locality }).reachable(query)
    expect(result.cities).toEqual([])
    expect(result.stats).toMatchObject({ stops: 3, railStops: 2 })
  })

  it('answers the same query from the cache without asking the provider again', async () => {
    const { transit, locality } = fakes([stop('Schlüchtern', 50.3412, 9.51, 42)])
    const service = new ReachabilityService({ transit, locality })
    await service.reachable(query)
    const second = await service.reachable(query)
    expect(second.cached).toBe(true)
    expect(transit.reachableStops).toHaveBeenCalledTimes(1)
  })

  it('remembers station towns across restarts, so a new search does not look them up again', async () => {
    const { transit, locality } = fakes([stop('Schlüchtern', 50.3412, 9.51, 42)])
    const store = new PersistentMap<Locality>()
    await new ReachabilityService({ transit, locality, localityStore: store }).reachable(query)
    const lookupsAfterFirst = vi.mocked(locality.localityAt).mock.calls.length

    // A "restarted" service with the same store: only the origin is asked again (it is kept in memory only).
    const other = { ...query, maxMinutes: 90 }
    const { result } = await new ReachabilityService({ transit, locality, localityStore: store }).reachable(other)
    expect(vi.mocked(locality.localityAt).mock.calls.length).toBe(lookupsAfterFirst + 1)
    expect(result.stats.localityLookups).toBe(0)
  })

  it('finds the origin station by name and caches the answer', async () => {
    const { transit, locality } = fakes([])
    const service = new ReachabilityService({ transit, locality })
    expect(await service.findOrigin('Fulda')).toEqual(FULDA)
    expect(await service.findOrigin(' fulda ')).toEqual(FULDA) // same key, from the cache
    expect(await service.findOrigin('Atlantis')).toBeNull()
    expect(transit.findStations).toHaveBeenCalledTimes(2)
  })
})

describe('mergeNearbyStops', () => {
  it('treats stops within the radius as one station, represented by the fastest', () => {
    const merged = mergeNearbyStops(
      [stop('platform 2', 50.0, 9.0, 50), stop('platform 1', 50.001, 9.0, 45), stop('far away', 50.1, 9.0, 40)],
      400,
    )
    expect(merged.map((s) => s.id)).toEqual(['far away', 'platform 1'])
  })
})

describe('slugify', () => {
  it('makes stable ASCII ids', () => {
    expect(slugify('Schlüchtern')).toBe('schluchtern')
    expect(slugify('Frankfurt am Main')).toBe('frankfurt-am-main')
    expect(slugify('Gießen')).toBe('giessen')
  })
})

describe('origin search', () => {
  const service = (stations: { name: string; country?: string }[]) =>
    new ReachabilityService({
      transit: {
        name: 'fake',
        findStations: async () => stations.map((s, i) => ({ id: String(i), lat: 50, lon: 9, ...s })),
        reachableStops: async () => [],
      },
      locality: { name: 'fake', localityAt: async () => null },
    })

  it('ignores fuzzy matches that are not the asked place (a typo must not become New York)', async () => {
    expect(await service([{ name: 'Atlantic Av', country: 'US' }]).findOrigin('Atlantisxyz')).toBeNull()
  })

  it('ignores stations outside the allowed countries', async () => {
    expect(await service([{ name: 'Fulda', country: 'US' }]).findOrigin('Fulda')).toBeNull()
  })

  it('accepts a real match, with or without a country from the provider', async () => {
    expect((await service([{ name: 'Frankfurt (Main) Hbf', country: 'DE' }]).findOrigin('frankfurt'))?.name).toBe(
      'Frankfurt (Main) Hbf',
    )
    expect((await service([{ name: 'Fulda' }]).findOrigin('Fulda'))?.name).toBe('Fulda')
  })
})

describe('namesMatch', () => {
  it.each([
    ['Fulda', 'Fulda', true],
    ['Gießen', 'Gießen Bahnhof', true],
    ['marburg', 'Marburg(Lahn)', true],
    ['Bad Hersfeld', 'Bad Hersfeld Bahnhof', true],
    ['Atlantisxyz', 'Atlantic Av', false],
    ['Fulda Hbf', 'Fulda Paulustor', false],
    ['', 'Fulda', false],
  ])('%s ~ %s → %s', (query, name, expected) => {
    expect(namesMatch(query, name)).toBe(expected)
  })
})
