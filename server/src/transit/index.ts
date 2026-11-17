import { APP_VERSION } from '../version.js'
import { Transitous } from './transitous.js'
import type { LocalityResolver, TransitProvider } from './types.js'

export * from './types.js'

export const USER_AGENT = `WanderBuddy/${APP_VERSION} (+https://wander-buddy.zebaro.dev)`

/**
 * The registry of data sources. To add one: implement TransitProvider and/or LocalityResolver in its own
 * file, add a line here, set TRANSIT_PROVIDER / LOCALITY_RESOLVER. Nothing else in the server changes.
 */
const transitProviders: Record<string, () => TransitProvider> = {
  transitous: () => new Transitous({ userAgent: USER_AGENT }),
}

const localityResolvers: Record<string, () => LocalityResolver> = {
  transitous: () => new Transitous({ userAgent: USER_AGENT }),
}

function pick<T>(registry: Record<string, () => T>, name: string, variable: string): T {
  const make = registry[name]
  if (!make) throw new Error(`${variable}=${name} is unknown; known: ${Object.keys(registry).join(', ')}`)
  return make()
}

export function createTransitProvider(name = process.env.TRANSIT_PROVIDER ?? 'transitous'): TransitProvider {
  return pick(transitProviders, name, 'TRANSIT_PROVIDER')
}

export function createLocalityResolver(name = process.env.LOCALITY_RESOLVER ?? 'transitous'): LocalityResolver {
  return pick(localityResolvers, name, 'LOCALITY_RESOLVER')
}
