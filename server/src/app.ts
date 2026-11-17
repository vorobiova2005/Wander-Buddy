import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'

/**
 * Every API response is JSON.
 * Success: `{ "ok": true, ...payload }`.
 * Failure: `{ "ok": false, "error": { "code": "<machine_code>", "message": "<for logs>" } }`.
 */
export type ApiError = { ok: false; error: { code: string; message: string } }

const apiError = (code: string, message: string): ApiError => ({ ok: false, error: { code, message } })

export function createApp(options: { staticRoot?: string } = {}) {
  const app = new Hono()

  const api = new Hono()
  api.get('/health', (c) => c.json({ ok: true }))
  api.all('*', (c) => c.json(apiError('not_found', `No route ${c.req.method} ${c.req.path}`), 404))
  app.route('/api', api)

  app.onError((err, c) => {
    console.error(err)
    return c.json(apiError('internal', 'Internal server error'), 500)
  })

  // The built web app (web/dist) is served by the same process: one container, one port.
  if (options.staticRoot) {
    app.use('*', serveStatic({ root: options.staticRoot }))
    // Single-page app: any other path falls back to index.html.
    app.get('*', serveStatic({ root: options.staticRoot, path: 'index.html' }))
  }

  return app
}
