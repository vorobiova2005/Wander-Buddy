/** Wall-clock date and time in a time zone → the UTC instant. Handles summer/winter time. */
export function zonedTimeToUtc(date: string, time: string, timeZone = 'Europe/Berlin'): Date {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi)
  let utc = asIfUtc - offsetMinutes(new Date(asIfUtc), timeZone) * 60_000
  // Near a clock change the first guess can use the other offset; one correction settles it.
  utc = asIfUtc - offsetMinutes(new Date(utc), timeZone) * 60_000
  return new Date(utc)
}

/** A real calendar date (YYYY-MM-DD) and wall-clock time (HH:MM): no 31 February, no 25:99. */
export function isValidDateTime(date: string, time: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const day = new Date(Date.UTC(y, mo - 1, d))
  return day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d && h < 24 && mi < 60
}

/** Today's date in a time zone, YYYY-MM-DD. */
export function todayIn(timeZone = 'Europe/Berlin', now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'))
  return Math.round((wall - at.getTime()) / 60_000)
}
