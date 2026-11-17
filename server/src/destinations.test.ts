import { describe, expect, it, vi } from 'vitest'
import { PersistentMap } from './cache.js'
import { DestinationService, type StoredPlaces } from './destinations.js'
import type { Place, PlacesProvider, Weather, WeatherProvider } from './enrichment/types.js'
import { ReachabilityService } from './reachability.js'
import { UpstreamError, type Coordinates, type Locality } from './transit/types.js'

// Fakes everywhere: the service must work with any weather, places and transit source.
const CENTER = { lat: 50.9747, lon: 10.3194 }
const STATION = { lat: 50.986, lon: 10.193 }

function reachability() {
  return new ReachabilityService({
    transit: {
      name: 'fake',
      findStations: async () => [],
      reachableStops: async () => [
        { id: 'h', name: 'Hörschel Hp', ...STATION, minutes: 92, vehicles: 2, arrival: 'x', rail: true },
        { id: 'v', name: 'Dorf', lat: 50.5, lon: 9.7, minutes: 20, vehicles: 1, arrival: 'x', rail: true },
      ],
    },
    locality: {
      name: 'fake',
      localityAt: async (p: Coordinates): Promise<Locality | null> =>
        p.lat === STATION.lat
          ? { name: 'Eisenach', kind: 'town', center: CENTER }
          : p.lat === 50.5
            ? { name: 'Dorf', kind: 'village' }
            : { name: 'Fulda', kind: 'town' },
    },
  })
}

const sunny: Weather = {
  date: '2026-11-21',
  code: 0,
  tempMax: 10,
  tempMin: 2,
  precipitationProbability: 5,
  precipitationMm: 0,
  windMaxKmh: 8,
  sunshineHours: 7,
}
const wartburg: Place = { id: 'otm:W', name: 'Wartburg', category: 'historic', rating: 3, distance: 2000, lat: 50.96, lon: 10.3 }

function setup(
  over: {
    weather?: Partial<WeatherProvider>
    places?: Partial<PlacesProvider>
    today?: string
    maxPlacesTowns?: number
    now?: () => number
  } = {},
) {
  const weather: WeatherProvider = { name: 'w', horizonDays: 15, daily: vi.fn(async (pts) => pts.map(() => sunny)), ...over.weather }
  const places: PlacesProvider = { name: 'p', near: vi.fn(async () => [wartburg]), ...over.places }
  const store = new PersistentMap<StoredPlaces>()
  const service = new DestinationService({
    reachability: reachability(),
    weather,
    places,
    placesStore: store,
    today: () => over.today ?? '2026-11-17',
    maxPlacesTowns: over.maxPlacesTowns,
    now: over.now,
  })
  return { service, weather, places, store }
}

const query = { origin: { id: 'o', name: 'Fulda', lat: 50.55, lon: 9.68 }, departure: new Date('2026-11-21T08:00:00Z'), maxMinutes: 120 }

describe('DestinationService', () => {
  it('adds weather and places, looked up at the town centre rather than the suburban station', async () => {
    const { service, weather, places } = setup()
    const { result } = await service.destinations(query, { villages: false })
    expect(result.date).toBe('2026-11-21')
    expect(result.cities).toHaveLength(1) // the village is left out before any enrichment request
    const [eisenach] = result.cities
    expect(eisenach).toMatchObject({ name: 'Eisenach', weather: sunny, places: [wartburg], center: CENTER })
    expect(vi.mocked(places.near).mock.calls[0][0]).toEqual(CENTER)
    expect(vi.mocked(weather.daily).mock.calls[0][0]).toEqual([CENTER])
    expect(result.enrichment).toEqual({
      weather: 'ok',
      weatherSource: 'w',
      placesSource: 'p',
      placesFailures: 0,
      placesSkipped: 0,
      placesPaused: false,
    })
  })

  it('says "out of range" instead of failing for a day beyond the forecast', async () => {
    const { service, weather } = setup({ today: '2026-10-01' })
    const { result } = await service.destinations(query, { villages: false })
    expect(result.enrichment.weather).toBe('out_of_range')
    expect(result.cities[0].weather).toBeNull()
    expect(weather.daily).not.toHaveBeenCalled()
  })

  it('still answers when the weather source is down', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { service } = setup({
      weather: {
        daily: async () => {
          throw new UpstreamError('w', 'down')
        },
      },
    })
    const { result } = await service.destinations(query, { villages: false })
    expect(result.enrichment.weather).toBe('unavailable')
    expect(result.cities[0].places).toEqual([wartburg])
    warn.mockRestore()
  })

  it('still answers when places fail, counts the failures and does not keep the empty list', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { service, store } = setup({
      places: {
        near: async () => {
          throw new UpstreamError('p', 'HTTP 429')
        },
      },
    })
    const { result } = await service.destinations(query, { villages: false })
    expect(result.enrichment.placesFailures).toBe(1)
    expect(result.cities[0].places).toEqual([])
    expect(store.size).toBe(0)
    warn.mockRestore()
  })

  it('keeps found places for good, so the next search does not ask again', async () => {
    const { service, places, store } = setup()
    await service.destinations(query, { villages: false })
    await service.destinations({ ...query, departure: new Date('2026-11-21T10:00:00Z') }, { villages: false })
    expect(places.near).toHaveBeenCalledTimes(1)
    expect(store.size).toBe(1)
  })

  it('caches the weather per day and point', async () => {
    const { service, weather } = setup()
    await service.destinations(query, { villages: false })
    await service.destinations({ ...query, departure: new Date('2026-11-21T10:00:00Z') }, { villages: false })
    expect(weather.daily).toHaveBeenCalledTimes(1)
  })

  it('never asks for places of villages, even when villages are shown (quota)', async () => {
    const { service, places } = setup()
    const { result } = await service.destinations(query, { villages: true })
    const dorf = result.cities.find((c) => c.name === 'Dorf')
    expect(dorf?.places).toEqual([])
    expect(places.near).toHaveBeenCalledTimes(1) // Eisenach only
    expect(result.enrichment.placesSkipped).toBe(1)
  })

  it('asks for places of at most maxPlacesTowns towns per search', async () => {
    const { service, places } = setup({ maxPlacesTowns: 0 })
    const { result } = await service.destinations(query, { villages: false })
    expect(places.near).not.toHaveBeenCalled()
    expect(result.cities[0].places).toEqual([])
    expect(result.enrichment.placesSkipped).toBe(1)
  })

  it('pauses a places source that keeps failing, then tries again after the pause', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 0
    const near = vi.fn(async (): Promise<Place[]> => {
      throw new UpstreamError('p', 'HTTP 429')
    })
    const { service } = setup({ places: { near }, now: () => now })
    for (let i = 0; i < 3; i++) await service.destinations(query, { villages: false }) // 3 failures in a row
    expect(near).toHaveBeenCalledTimes(3)

    const paused = await service.destinations(query, { villages: false })
    expect(near).toHaveBeenCalledTimes(3) // not asked while paused
    expect(paused.result.enrichment).toMatchObject({ placesPaused: true, placesSkipped: 1, placesFailures: 0 })

    now = 11 * 60_000 // the pause (10 min) is over
    await service.destinations(query, { villages: false })
    expect(near).toHaveBeenCalledTimes(4)
    warn.mockRestore()
  })
})
