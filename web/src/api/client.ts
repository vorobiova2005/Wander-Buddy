import type { Destinations, Station, VerdictAnswer } from './types'

/** What the user searched for; it is also the URL of the results (lib/router.ts), so a search can be shared. */
export type Search = {
  /** A station or town name, or empty when the origin is a point (lat/lon). */
  from: string
  lat?: number
  lon?: number
  /** YYYY-MM-DD, Europe/Berlin. */
  date: string
  /** HH:MM, Europe/Berlin. */
  time: string
  maxMinutes: number
}

/** A failed call: `code` is the server's error code, or `network` / `bad_answer`. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function searchParams(s: Search): URLSearchParams {
  const p = new URLSearchParams()
  if (s.lat !== undefined && s.lon !== undefined) {
    p.set('lat', s.lat.toFixed(4))
    p.set('lon', s.lon.toFixed(4))
  } else {
    p.set('from', s.from)
  }
  p.set('date', s.date)
  p.set('time', s.time)
  p.set('maxMinutes', String(s.maxMinutes))
  return p
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('network', 'The server did not answer')
  }
  let body: { ok?: boolean; error?: { code: string; message: string } } & T
  try {
    body = await res.json()
  } catch {
    throw new ApiError('bad_answer', `HTTP ${res.status}`)
  }
  if (!res.ok || body.ok === false) {
    throw new ApiError(body.error?.code ?? 'bad_answer', body.error?.message ?? `HTTP ${res.status}`)
  }
  return body
}

export const api = {
  stations: (q: string, signal?: AbortSignal) =>
    get<{ stations: Station[] }>(`/api/stations?q=${encodeURIComponent(q)}`, signal).then((b) => b.stations),
  destinations: (s: Search, signal?: AbortSignal) =>
    get<Destinations>(`/api/destinations?${searchParams(s)}`, signal),
  verdict: (s: Search, signal?: AbortSignal) => get<VerdictAnswer>(`/api/verdict?${searchParams(s)}`, signal),
}
