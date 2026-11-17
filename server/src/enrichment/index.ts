import { USER_AGENT } from '../transit/index.js'
import { OpenMeteo } from './openmeteo.js'
import { OpenTripMap } from './opentripmap.js'
import type { PlacesProvider, WeatherProvider } from './types.js'

export * from './types.js'

/** Places are optional: without a key the app still works, towns just come without places. */
class NoPlaces implements PlacesProvider {
  readonly name = 'none'
  async near() {
    return []
  }
}

/**
 * The registry of enrichment sources. To add one: implement WeatherProvider or PlacesProvider in its own
 * file, add a line here, set WEATHER_PROVIDER / PLACES_PROVIDER.
 */
const weatherProviders: Record<string, () => WeatherProvider> = {
  'open-meteo': () => new OpenMeteo({ userAgent: USER_AGENT }),
}

const placesProviders: Record<string, () => PlacesProvider> = {
  opentripmap: () => {
    const apiKey = process.env.OPENTRIPMAP_API_KEY
    if (!apiKey) {
      console.warn('OPENTRIPMAP_API_KEY is not set: towns come without places')
      return new NoPlaces()
    }
    return new OpenTripMap({ apiKey, userAgent: USER_AGENT })
  },
  none: () => new NoPlaces(),
}

function pick<T>(registry: Record<string, () => T>, name: string, variable: string): T {
  const make = registry[name]
  if (!make) throw new Error(`${variable}=${name} is unknown; known: ${Object.keys(registry).join(', ')}`)
  return make()
}

export function createWeatherProvider(name = process.env.WEATHER_PROVIDER ?? 'open-meteo'): WeatherProvider {
  return pick(weatherProviders, name, 'WEATHER_PROVIDER')
}

export function createPlacesProvider(name = process.env.PLACES_PROVIDER ?? 'opentripmap'): PlacesProvider {
  return pick(placesProviders, name, 'PLACES_PROVIDER')
}
