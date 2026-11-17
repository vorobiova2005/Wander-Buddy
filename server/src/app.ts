import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { APP_VERSION } from './version.js'

/**
 * Every API response is JSON.
 * Success: `{ "ok": true, ...payload }`.
 * Failure: `{ "ok": false, "error": { "code": "<machine_code>", "message": "<for logs>" } }`.
 */
export type ApiError = { ok: false; error: { code: string; message: string } }

const apiError = (code: string, message: string): ApiError => ({ ok: false, error: { code, message } })

/** Production site and the Vite dev server. Override with CORS_ORIGINS (comma-separated). */
export const DEFAULT_CORS_ORIGINS = ['https://wander-buddy.zebaro.dev', 'http://localhost:5173']

export function createApp(options: { corsOrigins?: string[] } = {}) {
  const app = new Hono()

  // The site normally reaches the API through its own origin (nginx proxies /api), so CORS only
  // matters for direct calls to the API from an allowed origin.
  app.use('/api/*', cors({ origin: options.corsOrigins ?? DEFAULT_CORS_ORIGINS }))

  const api = new Hono()
  api.get('/health', (c) => c.json({ ok: true, version: APP_VERSION }))
  api.all('*', (c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.route('/api', api)

  app.notFound((c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.onError((err, c) => {
    console.error(err)
    return c.json(apiError('internal', 'Internal server error'), 500)
  })

  return app
}
