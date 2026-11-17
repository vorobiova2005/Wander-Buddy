import { serve } from '@hono/node-server'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 8080)
// Set in the Docker image. Empty in development: there Vite serves the web app and proxies /api here.
const staticRoot = process.env.STATIC_ROOT

serve({ fetch: createApp({ staticRoot }).fetch, port }, (info) => {
  console.log(`Wander Buddy server listening on :${info.port}`)
})
