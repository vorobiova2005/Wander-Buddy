import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, searchParams, type Search } from '../api/client'
import type { Destinations, VerdictAnswer } from '../api/types'

/**
 * The data of one search: the towns first (they appear as soon as they come), then the AI verdict over them.
 * Answers are kept for the visit, so moving between the results and a quest does not ask the server again.
 */
export type Loadable<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: ApiError }

const destinationsCache = new Map<string, Promise<Destinations>>()
const verdictCache = new Map<string, Promise<VerdictAnswer>>()

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key)
  if (!p) {
    p = load()
    cache.set(key, p)
    const mine = p
    // A failure is not kept: the next try asks again. Only this request's entry - not a newer retry's answer.
    p.catch(() => {
      if (cache.get(key) === mine) cache.delete(key)
    })
  }
  return p
}

/** For tests: forget the answers of earlier searches. */
export function clearTripCache() {
  destinationsCache.clear()
  verdictCache.clear()
}

const asApiError = (err: unknown) => (err instanceof ApiError ? err : new ApiError('network', String(err)))

export function useTrip(search: Search) {
  const key = searchParams(search).toString()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; destinations: Loadable<Destinations>; verdict: Loadable<VerdictAnswer> }>(
    { key, destinations: { status: 'loading' }, verdict: { status: 'loading' } },
  )

  useEffect(() => {
    let live = true
    cached(destinationsCache, key, () => api.destinations(search))
      .then((data) => {
        if (!live) return
        setState({ key, destinations: { status: 'ok', data }, verdict: { status: 'loading' } })
        // The verdict uses the same towns; the server has them cached by now.
        return cached(verdictCache, key, () => api.verdict(search)).then(
          (v) => live && setState((s) => ({ ...s, verdict: { status: 'ok', data: v } })),
          (err) => live && setState((s) => ({ ...s, verdict: { status: 'error', error: asApiError(err) } })),
        )
      })
      .catch((err) => {
        if (!live) return
        const error = asApiError(err)
        setState({ key, destinations: { status: 'error', error }, verdict: { status: 'error', error } })
      })
    return () => {
      live = false
    }
    // `search` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const retry = useCallback(() => {
    destinationsCache.delete(key)
    verdictCache.delete(key)
    setState({ key, destinations: { status: 'loading' }, verdict: { status: 'loading' } })
    setAttempt((a) => a + 1)
  }, [key])

  /** Ask only the AI again (the towns are fine). */
  const retryVerdict = useCallback(() => {
    verdictCache.delete(key)
    setState((s) => (s.key === key ? { ...s, verdict: { status: 'loading' } } : s))
    setAttempt((a) => a + 1)
  }, [key])

  // While the effect has not caught up with a new search, show loading rather than the old search's data.
  const current = state.key === key ? state : { key, destinations: { status: 'loading' } as const, verdict: { status: 'loading' } as const }
  return { destinations: current.destinations, verdict: current.verdict, retry, retryVerdict }
}
