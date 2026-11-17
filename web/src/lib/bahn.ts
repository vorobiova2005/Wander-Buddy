/**
 * A link to the timetable search on bahn.de with the trip filled in - the app never books anything, it only opens
 * the official timetable (regional trains are listed there too).
 */
export function bahnSearchUrl(from: string, to: string, date: string, time: string): string {
  const hash = new URLSearchParams({ sts: 'true', so: from, ...(to ? { zo: to } : {}), hd: `${date}T${time}:00`, hza: 'D', ar: 'false' })
  return `https://www.bahn.de/buchung/fahrplan/suche#${hash.toString()}`
}
