// Behaviour asked for by the code review of step 03: politeness, honest caching, privacy, resilience.
import { describe, expect, it, vi } from 'vitest'
import { PersistentMap } from './cache.js'
import { ReachabilityService } from './reachability.js'
import type { Coordinates, Locality, LocalityResolver, ReachableStop, TransitProvider } from './transit/types.js'

const ORIGIN = { id: 'o', name: 'Origin', lat: 50.5549, lon: 9.6842 }
const query = { origin: ORIGIN, departure: new Date('2026-11-21T08:00:00Z'), maxMinutes: 120 }
const station = (id: string, lat: number, minutes: number): ReachableStop => ({
  id,
  name: id,
  lat,
  lon: 9.5,
  minutes,
  vehicles: 1,
  arrival: 'x',
  rail: true,
})

function setup(localityAt: (p: Coordinates) => Promise<Locality | null>, stops = [station('A', 50.1, 30), station('B', 50.2, 40)]) {
  const transit: TransitProvider = {
    name: 'fake',
    findStations: vi.fn(async () => [ORIGIN]),
    reachableStops: vi.fn(async () => stops),
  }
  const locality: LocalityResolver = { name: 'fake', localityAt: vi.fn(localityAt) }
  return { transit, locality }
}

const townAt = async (p: Coordinates): Promise<Locality | null> =>
  p.lat === 50.1 ? { name: 'Alpha', kind: 'town' } : p.lat === 50.2 ? { name: 'Beta', kind: 'town' } : { name: 'Home', kind: 'town' }

describe('ReachabilityService (review)', () => {
  it('shares one upstream search between identical concurrent requests', async () => {
    const { transit, locality } = setup(townAt)
    const service = new ReachabilityService({ transit, locality })
    const [a, b] = await Promise.all([service.reachable(query), service.reachable(query)])
    expect(transit.reachableStops).toHaveBeenCalledTimes(1)
    expect(a.result).toBe(b.result)
  })

  it('shares one origin search between identical concurrent requests', async () => {
    const { transit, locality } = setup(townAt)
    const service = new ReachabilityService({ transit, locality })
    await Promise.all([service.findOrigin('Origin'), service.findOrigin('origin')])
    expect(transit.findStations).toHaveBeenCalledTimes(1)
  })

  it('keeps an answer with gaps only briefly and reports the failures', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { transit, locality } = setup(async (p) => {
      if (p.lat === 50.2) throw new Error('429')
      return townAt(p)
    })
    const service = new ReachabilityService({ transit, locality })
    const { result } = await service.reachable(query)
    expect(result.stats.localityFailures).toBe(1)
    expect(result.cities.map((c) => c.name)).toEqual(['Alpha'])

    now = 60_000
    expect((await service.reachable(query)).cached).toBe(true)
    now = 3 * 60_000 // past the short time to live: asked again
    expect((await service.reachable(query)).cached).toBe(false)
    vi.restoreAllMocks()
  })

  it('fails instead of answering wrongly when the origin town cannot be told', async () => {
    const { transit, locality } = setup(async (p) => {
      if (p.lat === ORIGIN.lat) throw new Error('down')
      return townAt(p)
    })
    await expect(new ReachabilityService({ transit, locality }).reachable(query)).rejects.toThrow('down')
  })

  it('never writes the origin (possibly the user’s own location) to the lasting store', async () => {
    const store = new PersistentMap<Locality>()
    const { transit, locality } = setup(townAt)
    await new ReachabilityService({ transit, locality, localityStore: store }).reachable(query)
    expect(store.has('50.555,9.684')).toBe(false)
    expect(store.size).toBe(2) // the two stations only
  })

  it('does not store "unknown town" for good', async () => {
    const store = new PersistentMap<Locality>()
    const { transit, locality } = setup(async (p) => (p.lat === 50.2 ? null : townAt(p)))
    await new ReachabilityService({ transit, locality, localityStore: store }).reachable(query)
    expect(store.has('50.200,9.500')).toBe(false)
  })

  it('still answers (and caches) when the lasting store cannot be saved', async () => {
    const store = new PersistentMap<Locality>()
    vi.spyOn(store, 'save').mockImplementation(() => {
      throw new Error('disk full')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { transit, locality } = setup(townAt)
    const service = new ReachabilityService({ transit, locality, localityStore: store })
    expect((await service.reachable(query)).result.cities).toHaveLength(2)
    expect((await service.reachable(query)).cached).toBe(true)
    expect(warn).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
