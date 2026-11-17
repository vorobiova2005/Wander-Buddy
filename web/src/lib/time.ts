/** Dates and times of a trip - always in Europe/Berlin, whatever the device's time zone is. */

const ZONE = 'Europe/Berlin'

/** Today in Berlin as YYYY-MM-DD. */
export function todayBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * The two weekend days to offer first: this Saturday and Sunday; on a Saturday - today and tomorrow; on a Sunday -
 * today and the next Saturday.
 */
export function weekendDays(today: string): string[] {
  const wd = weekday(today)
  if (wd === 6) return [today, addDays(today, 1)]
  if (wd === 0) return [today, addDays(today, 6)]
  const saturday = addDays(today, 6 - wd)
  return [saturday, addDays(saturday, 1)]
}

/** "сб 21.11" */
export function shortDay(date: string, locale = 'uk-UA'): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d, 12))
  const wd = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(day).replace('.', '')
  return `${wd} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

/** ISO instant → HH:MM in Berlin; empty for a broken input. */
export function localTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('de-DE', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(t)
}

/** HH:MM + minutes → HH:MM, kept within the day (23:59 at most). */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Minutes → hours and minutes, for "до 2 год", "1 год 30 хв". */
export function splitMinutes(minutes: number): { h: number; m: number } {
  return { h: Math.floor(minutes / 60), m: minutes % 60 }
}
