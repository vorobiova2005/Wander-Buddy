import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { PersistentMap } from './cache.js'
import { DestinationService, type StoredPlaces } from './destinations.js'
import { createPlacesProvider, createWeatherProvider } from './enrichment/index.js'
import { ReachabilityService } from './reachability.js'
import { createLocalityResolver, createTransitProvider, type Locality } from './transit/index.js'
import { APP_VERSION } from './version.js'

const port = Number(process.env.PORT ?? 8080)
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean)
// Facts that survive restarts (station → town). A Docker volume in production.
const stateDir = process.env.STATE_DIR ?? 'state'

const transit = createTransitProvider()
const locality = createLocalityResolver()
// One file per resolver: switching LOCALITY_RESOLVER never serves the old resolver's answers.
// v2: entries carry the town centre; v1 files (without it) are left alone and no longer read.
const localityStore = new PersistentMap<Locality>(join(stateDir, `localities.${locality.name}.v2.json`))
// Where an origin may be (ISO codes, comma-separated). Germany for the coursework.
const countries = (process.env.ORIGIN_COUNTRIES ?? 'DE').split(',').map((c) => c.trim()).filter(Boolean)
const reachability = new ReachabilityService({ transit, locality, localityStore, countries })

const weather = createWeatherProvider()
const places = createPlacesProvider()
// Found places survive restarts and deploys (a month), one file per places provider.
const placesStore = new PersistentMap<StoredPlaces>(join(stateDir, `places.${places.name}.json`))
const destinations = new DestinationService({ reachability, weather, places, placesStore })

serve({ fetch: createApp({ corsOrigins, reachability, destinations }).fetch, port }, (info) => {
  console.log(
    `Wander Buddy server v${APP_VERSION} on :${info.port} · transit=${transit.name} locality=${locality.name} ` +
      `weather=${weather.name} places=${places.name} · ${localityStore.size} known station localities`,
  )
})
