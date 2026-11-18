import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetProgress } from '../lib/progress'
import { ErrorBoundary } from './ErrorBoundary'

vi.mock('../lib/progress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/progress')>()
  return { ...actual, resetProgress: vi.fn(actual.resetProgress) }
})

let broken = true
function Fragile() {
  if (broken) throw new Error('broken progress')
  return <p>Screen is back</p>
}

beforeEach(() => {
  broken = true
  localStorage.clear()
  vi.mocked(resetProgress).mockClear()
  // React and the boundary log the crash; keep the test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('ErrorBoundary', () => {
  it('shows a way out instead of a blank page when a screen throws', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Щось зламалося' })).toBeInTheDocument()
    expect(screen.getByText(/Застосунок натрапив на помилку/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оновити сторінку' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Почати прогрес заново' })).toBeInTheDocument()
  })

  it('starting the progress over clears it and draws the screen again', () => {
    localStorage.setItem('wb.progress.v1', JSON.stringify({ v: 1, since: null, quests: {} }))
    window.history.replaceState(null, '', '/quest/x?from=Fulda')
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    broken = false // the reset removed what broke it
    fireEvent.click(screen.getByRole('button', { name: 'Почати прогрес заново' }))
    expect(resetProgress).toHaveBeenCalledOnce()
    expect(localStorage.getItem('wb.progress.v1')).toBeNull()
    expect(window.location.pathname).toBe('/')
    expect(screen.getByText('Screen is back')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
