import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { PersistentMap } from './cache.js'
import { DestinationService, PLACES_TTL_MS, type StoredPlaces } from './destinations.js'
import { createPlacesProvider, createWeatherProvider } from './enrichment/index.js'
import { createAiProvider } from './ai/index.js'
import { ReachabilityService } from './reachability.js'
import { VerdictService } from './verdict.js'
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
// v2: entries also carry sightsTotal; v1 files (without it) are left alone and no longer read.
// Lists older than the places' month are dropped on start, so the file does not grow for ever.
const placesStore = new PersistentMap<StoredPlaces>(
  join(stateDir, `places.${places.name}.v2.json`),
  (stored) => Date.now() - stored.at > PLACES_TTL_MS,
)
const destinations = new DestinationService({ reachability, weather, places, placesStore, placesTtlMs: PLACES_TTL_MS })

const ai = createAiProvider()
const verdicts = new VerdictService({ destinations, ai })

const server = serve({ fetch: createApp({ corsOrigins, reachability, destinations, verdicts }).fetch, port }, (info) => {
  console.log(
    `Wander Buddy server v${APP_VERSION} on :${info.port} · transit=${transit.name} locality=${locality.name} ` +
      `weather=${weather.name} places=${places.name} ai=${ai ? `${ai.name}:${ai.model}` : 'none'} · ` +
      `${localityStore.size} known station localities`,
  )
})

// `docker stop` and a deploy send SIGTERM: finish the open requests and leave, instead of being killed after 10 s.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal}: closing`)
    server.close(() => process.exit(0))
    // nginx keeps idle keep-alive connections open; they would hold close() until the fallback below.
    ;(server as { closeIdleConnections?: () => void }).closeIdleConnections?.()
    // Docker kills after 10 s: a long verdict still running is cut off, its search simply asks again.
    setTimeout(() => process.exit(0), 8_000).unref()
  })
}
