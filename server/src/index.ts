import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { APP_VERSION } from './version.js'

const port = Number(process.env.PORT ?? 8080)
const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean)

serve({ fetch: createApp({ corsOrigins }).fetch, port }, (info) => {
  console.log(`Wander Buddy server v${APP_VERSION} listening on :${info.port}`)
})
