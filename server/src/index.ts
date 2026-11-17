import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { PersistentMap } from './cache.js'
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
const localityStore = new PersistentMap<Locality>(join(stateDir, `localities.${locality.name}.json`))
// Where an origin may be (ISO codes, comma-separated). Germany for the coursework.
const countries = (process.env.ORIGIN_COUNTRIES ?? 'DE').split(',').map((c) => c.trim()).filter(Boolean)
const reachability = new ReachabilityService({ transit, locality, localityStore, countries })

serve({ fetch: createApp({ corsOrigins, reachability }).fetch, port }, (info) => {
  console.log(
    `Wander Buddy server v${APP_VERSION} on :${info.port} · transit=${transit.name} locality=${locality.name} ` +
      `· ${localityStore.size} known station localities`,
  )
})
