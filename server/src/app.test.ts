import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

describe('api', () => {
  const app = createApp()

  it('GET /api/health answers ok', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('unknown API route answers with the JSON error shape', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })
})
