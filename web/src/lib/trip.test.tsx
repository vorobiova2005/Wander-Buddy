import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Search } from '../api/client'
import { fakeApi } from '../test/fixtures'
import { addDays, todayBerlin } from './time'
import { clearTripCache, useTrip } from './trip'

function Harness({ search }: { search: Search }) {
  const trip = useTrip(search)
  return (
    <div>
      <p data-testid="destinations">{trip.destinations.status}</p>
      <button type="button" onClick={trip.retry}>
        retry
      </button>
    </div>
  )
}

const search: Search = { from: 'Fulda', date: addDays(todayBerlin(), 3), time: '09:00', maxMinutes: 120 }

beforeEach(() => clearTripCache())
afterEach(() => vi.unstubAllGlobals())

describe('trip cache', () => {
  it('a late failure of an old request does not drop the newer answer from the cache', async () => {
    const answer = fakeApi()
    let failFirst: (err: Error) => void = () => {}
    let destinationCalls = 0
    const fetch = vi.fn((input: string | URL | Request) => {
      if (String(input).startsWith('/api/destinations') && ++destinationCalls === 1) {
        return new Promise<Response>((_, reject) => {
          failFirst = reject
        })
      }
      return answer(input)
    })
    vi.stubGlobal('fetch', fetch)

    const first = render(<Harness search={search} />)
    expect(screen.getByTestId('destinations')).toHaveTextContent('loading')

    // The user retries while the first request still hangs; the retry answers.
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await screen.findByText('ok')

    // Now the first request finally fails.
    await act(async () => {
      failFirst(new Error('late failure'))
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.getByTestId('destinations')).toHaveTextContent('ok')

    // Back to the same search: the answer comes from the cache, the server is not asked again.
    first.unmount()
    render(<Harness search={search} />)
    await screen.findByText('ok')
    expect(destinationCalls).toBe(2)
  })

  it('a failure is not kept: the next mount asks again', async () => {
    let destinationCalls = 0
    const answer = fakeApi()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        if (String(input).startsWith('/api/destinations') && ++destinationCalls === 1) return Promise.reject(new TypeError('offline'))
        return answer(input)
      }),
    )
    const first = render(<Harness search={search} />)
    await screen.findByText('error')
    first.unmount()
    render(<Harness search={search} />)
    await screen.findByText('ok')
    expect(destinationCalls).toBe(2)
  })
})
