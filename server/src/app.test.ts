import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { VERSION_FILE } from './version.js'

describe('api', () => {
  const app = createApp()

  it('GET /api/health answers ok with the version from the VERSION file', async () => {
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: readFileSync(VERSION_FILE, 'utf-8').trim() })
  })

  it('unknown API route answers with the JSON error shape', async () => {
    const res = await app.request('/api/nope')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('not_found')
  })

  it('allows the production site origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://wander-buddy.zebaro.dev' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://wander-buddy.zebaro.dev')
  })

  it('does not allow a foreign origin', async () => {
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
