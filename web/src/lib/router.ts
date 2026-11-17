import { useSyncExternalStore } from 'react'
import type { Search } from '../api/client'
import { searchParams } from '../api/client'

/**
 * Screens live in the URL hash (#/results?from=Fulda&date=…): the back button works, a reload keeps the screen,
 * and a search can be sent to a friend. The server caches the answers, so coming back is instant.
 */
export type Route =
  | { name: 'search' }
  | { name: 'results'; search: Search }
  | { name: 'quest'; search: Search; cityId: string }
  | { name: 'progress' }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function readSearch(p: URLSearchParams): Search | null {
  const date = p.get('date') ?? ''
  const time = p.get('time') ?? ''
  const maxMinutes = Number(p.get('maxMinutes'))
  if (!DATE.test(date) || !TIME.test(time) || !Number.isInteger(maxMinutes) || maxMinutes < 15 || maxMinutes > 180) return null
  const lat = p.get('lat'), lon = p.get('lon')
  if (lat !== null && lon !== null) {
    const la = Number(lat), lo = Number(lon)
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
    return { from: '', lat: la, lon: lo, date, time, maxMinutes }
  }
  const from = (p.get('from') ?? '').trim()
  return from ? { from, date, time, maxMinutes } : null
}

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  if (path === '/progress') return { name: 'progress' }
  const search = readSearch(params)
  if (path === '/results' && search) return { name: 'results', search }
  const quest = /^\/quest\/([^/]+)$/.exec(path)
  if (quest && search) return { name: 'quest', search, cityId: decodeURIComponent(quest[1]) }
  return { name: 'search' }
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'search':
      return '#/'
    case 'progress':
      return '#/progress'
    case 'results':
      return `#/results?${searchParams(route.search)}`
    case 'quest':
      return `#/quest/${encodeURIComponent(route.cityId)}?${searchParams(route.search)}`
  }
}

const LAST_RESULTS = 'wb.lastResults'

export function navigate(route: Route) {
  const hash = routeHash(route)
  if (route.name === 'results' || route.name === 'quest') {
    try {
      sessionStorage.setItem(LAST_RESULTS, routeHash({ name: 'results', search: route.search }))
    } catch {
      // no storage - the Map tab then leads to the search
    }
  }
  scrollPositions.set(window.location.hash, window.scrollY)
  if (window.location.hash !== hash) window.location.hash = hash
  // Back to the results from a quest: the same place in the list; a new screen: the top.
  const y = scrollPositions.get(hash) ?? 0
  window.scrollTo({ top: 0 })
  if (y > 0) setTimeout(() => window.scrollTo({ top: y }), 60)
}

const scrollPositions = new Map<string, number>()

/** The results of the last search in this tab - where the "Map" tab leads. */
export function lastResults(): Route | null {
  try {
    const hash = sessionStorage.getItem(LAST_RESULTS)
    return hash ? parseRoute(hash) : null
  } catch {
    return null
  }
}

function subscribe(listener: () => void) {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => '')
  return parseRoute(hash)
}
