import type { Weather } from '../api/types'

/** WMO weather code (Open-Meteo) → an icon and the i18n key of its words (weather.kind.*). */
export function weatherKind(code: number): { icon: string; key: string } {
  if (code === 0) return { icon: '☀️', key: 'clear' }
  if (code <= 2) return { icon: '🌤️', key: 'partly' }
  if (code === 3) return { icon: '☁️', key: 'cloudy' }
  if (code === 45 || code === 48) return { icon: '🌫️', key: 'fog' }
  if (code >= 51 && code <= 57) return { icon: '🌦️', key: 'drizzle' }
  if (code >= 61 && code <= 67) return { icon: '🌧️', key: 'rain' }
  if (code >= 71 && code <= 77) return { icon: '🌨️', key: 'snow' }
  if (code >= 80 && code <= 82) return { icon: '🌦️', key: 'showers' }
  if (code === 85 || code === 86) return { icon: '🌨️', key: 'snow' }
  if (code >= 95) return { icon: '⛈️', key: 'storm' }
  return { icon: '🌡️', key: 'unknown' }
}

/** Thresholds of the situational moods (docs/ui.md). */
export const RAINY_CHANCE = 60
export const COLD_MAX = 3

export const isRainy = (w: Weather | null) => (w?.precipitationProbability ?? 0) >= RAINY_CHANCE
export const isCold = (w: Weather | null) => w !== null && w.tempMax <= COLD_MAX

/** "1…7 °C" with whole degrees. */
export function tempRange(w: Weather): string {
  return `${Math.round(w.tempMin)}…${Math.round(w.tempMax)} °C`
}
