import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('shows the Ukrainian title and reports a live server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({ ok: true }) }))
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Wander Buddy' })).toBeInTheDocument()
    expect(await screen.findByText("Сервер на зв'язку")).toBeInTheDocument()
  })

  it('reports a server that does not answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    render(<App />)
    expect(await screen.findByText('Сервер не відповідає')).toBeInTheDocument()
  })
})
