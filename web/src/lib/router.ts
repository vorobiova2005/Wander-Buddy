import { useSyncExternalStore } from 'react'
import type { Search } from '../api/client'
import { searchParams } from '../api/client'

/**
 * Screens live in clean URLs (/results?from=Fulda&date=…, /quest/hunfeld?…, /progress) through the History API:
 * the back button works, a reload keeps the screen, a search can be sent to a friend. The web server answers every
 * path with index.html (web/nginx.conf, Vite in development); the server caches the answers, so coming back is
 * instant. Old links with "#/" are moved to the clean URL on load.
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

/** "/results?from=…" (a path with its query) → the screen. Anything unknown → the search. */
export function parseRoute(url: string): Route {
  const [rawPath, query = ''] = url.replace(/^#/, '').split('?')
  const path = rawPath.replace(/\/+$/, '') || '/'
  const params = new URLSearchParams(query)
  if (path === '/progress') return { name: 'progress' }
  const search = readSearch(params)
  if (path === '/results' && search) return { name: 'results', search }
  const quest = /^\/quest\/([^/]+)$/.exec(path)
  if (quest && search) return { name: 'quest', search, cityId: decodeURIComponent(quest[1]) }
  return { name: 'search' }
}

export function routeUrl(route: Route): string {
  switch (route.name) {
    case 'search':
      return '/'
    case 'progress':
      return '/progress'
    case 'results':
      return `/results?${searchParams(route.search)}`
    case 'quest':
      return `/quest/${encodeURIComponent(route.cityId)}?${searchParams(route.search)}`
  }
}

const here = () => window.location.pathname + window.location.search
const LAST_RESULTS = 'wb.lastResults'
const scrollPositions = new Map<string, number>()

export function navigate(route: Route) {
  const url = routeUrl(route)
  if (route.name === 'results' || route.name === 'quest') {
    try {
      sessionStorage.setItem(LAST_RESULTS, routeUrl({ name: 'results', search: route.search }))
    } catch {
      // no storage - the Map tab then leads to the search
    }
  }
  scrollPositions.set(here(), window.scrollY)
  if (here() !== url) {
    window.history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  // Back to the results from a quest: the same place in the list; a new screen: the top.
  const y = scrollPositions.get(url) ?? 0
  window.scrollTo({ top: 0 })
  if (y > 0) setTimeout(() => window.scrollTo({ top: y }), 60)
}

/** The results of the last search in this tab - where the "Map" tab leads. */
export function lastResults(): Route | null {
  try {
    const url = sessionStorage.getItem(LAST_RESULTS)
    return url ? parseRoute(url) : null
  } catch {
    return null
  }
}

/** A link from the hash days (/#/results?…) becomes the clean URL, without a new history entry. */
export function upgradeHashUrl() {
  if (window.location.hash.startsWith('#/')) {
    window.history.replaceState(null, '', window.location.hash.slice(1))
  }
}

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function useRoute(): Route {
  const url = useSyncExternalStore(subscribe, here, () => '/')
  return parseRoute(url)
}
