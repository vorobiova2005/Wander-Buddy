/**
 * Step 08 measurements against a running Wander Buddy (production by default). Prints Markdown tables and saves the
 * raw numbers as JSON next to docs/measurements.md, so every figure in the thesis can be traced back.
 *
 *   npm run measure -w server -- routes            accuracy: the control routes from Fulda vs bahn.de
 *   npm run measure -w server -- timing            response time: a new search vs the same search again (cache)
 *   BASE=http://localhost:8080 npm run measure -w server -- timing
 *
 * Polite to the sources: new searches (that reach Transitous, Open-Meteo, OpenTripMap, Groq) are few and spaced;
 * repeated searches are answered from the server's cache and cost the sources nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'https://wander-buddy.zebaro.dev'
const OUT = new URL('../../docs/measurements-data/', import.meta.url)
const UA = 'WanderBuddy-measure (+https://wander-buddy.zebaro.dev)'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function timed(path: string): Promise<{ ms: number; status: number; cache: string | null; body: unknown }> {
  const t0 = performance.now()
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  const body = await res.json()
  return { ms: performance.now() - t0, status: res.status, cache: res.headers.get('x-cache'), body }
}

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(new URL(name, OUT), JSON.stringify({ base: BASE, at: new Date().toISOString(), ...(data as object) }, null, 2) + '\n')
}

// ---- accuracy -------------------------------------------------------------------------------------

/** docs/control-routes.md: bahn.de, Sat 21.11.2026, from 09:00, Deutschland-Ticket connections only. */
const CONTROL = [
  { town: 'Schlüchtern', bahn: { dep: '09:12', arr: '09:37', transfers: 0 } },
  { town: 'Bad Hersfeld', bahn: { dep: '09:20', arr: '09:48', transfers: 0 } },
  { town: 'Gelnhausen', bahn: { dep: '09:12', arr: '09:59', transfers: 0 } },
  { town: 'Hanau', bahn: { dep: '09:12', arr: '10:13', transfers: 0 } },
  { town: 'Eisenach', bahn: { dep: '09:20', arr: '10:40', transfers: 1 } },
  { town: 'Frankfurt am Main', bahn: { dep: '09:12', arr: '10:33', transfers: 0 } },
  { town: 'Kassel', bahn: { dep: '09:20', arr: '10:51', transfers: 0 } },
  { town: 'Gießen', bahn: { dep: '09:33', arr: '11:16', transfers: 0 } },
  { town: 'Würzburg', bahn: { dep: '10:12', arr: '12:00', transfers: 1 } },
  { town: 'Marburg', bahn: { dep: '09:33', arr: '11:34', transfers: 2 } },
]
const THRESHOLD_MIN = 10

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const berlin = (iso: string) =>
  new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

type City = { name: string; minutes: number; transfers: number; arrival: string; station: { name: string } }

async function routes() {
  // One search covers all ten routes: up to 3 h (Würzburg arrives at 12:00), villages included in the list.
  const r = await timed('/api/reachable?from=Fulda&date=2026-11-21&time=09:00&maxMinutes=180&villages=true')
  if (r.status !== 200) throw new Error(`reachable answered ${r.status}: ${JSON.stringify(r.body)}`)
  const cities = (r.body as { cities: City[] }).cities
  const rows = CONTROL.map((c) => {
    const found = cities.find((x) => x.name === c.town)
    if (!found) return { ...c, found: null }
    const arr = berlin(found.arrival)
    const diff = toMin(arr) - toMin(c.bahn.arr)
    return {
      ...c,
      found: { station: found.station.name, arrival: arr, minutes: found.minutes, transfers: found.transfers },
      bahnMinutesFrom0900: toMin(c.bahn.arr) - toMin('09:00'),
      arrivalDiff: diff,
      ok: Math.abs(diff) <= THRESHOLD_MIN,
      sameTransfers: found.transfers === c.bahn.transfers,
    }
  })
  save('routes.json', { threshold: THRESHOLD_MIN, responseMs: Math.round(r.ms), cache: r.cache, towns: cities.length, rows })

  console.log(`\nAccuracy - Fulda, Sat 21.11.2026, 09:00, up to 180 min (${cities.length} towns; ${BASE}, x-cache ${r.cache})\n`)
  console.log('| # | Town | bahn.de arrival | Wander Buddy arrival | Δ min | Minutes from 09:00 (bahn / WB) | Transfers (bahn / WB) | WB station |')
  console.log('| -: | ---- | --------------- | -------------------- | ----: | ------------------------------ | --------------------- | ---------- |')
  rows.forEach((row, i) => {
    if (!row.found) {
      console.log(`| ${i + 1} | ${row.town} | ${row.bahn.arr} | not found | - | - | ${row.bahn.transfers} / - | - |`)
      return
    }
    const d = row.arrivalDiff!
    console.log(
      `| ${i + 1} | ${row.town} | ${row.bahn.arr} | ${row.found.arrival} | ${d > 0 ? '+' : ''}${d}${row.ok ? '' : ' ⚠️'} | ` +
        `${row.bahnMinutesFrom0900} / ${row.found.minutes} | ${row.bahn.transfers} / ${row.found.transfers}${row.sameTransfers ? '' : ' ⚠️'} | ${row.found.station} |`,
    )
  })
  const found = rows.filter((x) => x.found)
  const ok = found.filter((x) => x.ok)
  const diffs = found.map((x) => Math.abs(x.arrivalDiff!))
  console.log(
    `\nFound ${found.length}/${rows.length}; within ±${THRESHOLD_MIN} min: ${ok.length}/${rows.length}; ` +
      `mean |Δ| ${(diffs.reduce((a, b) => a + b, 0) / Math.max(1, diffs.length)).toFixed(1)} min; ` +
      `same transfers: ${found.filter((x) => x.sameTransfers).length}/${found.length}`,
  )
}

// ---- response time --------------------------------------------------------------------------------

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return { n: s.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length, median: mid, min: s[0], max: s.at(-1)! }
}

async function timing() {
  const COLD = Number(process.env.COLD ?? 3)
  const WARM = Number(process.env.WARM ?? 10)
  // A new search = a departure time nobody asked before (the answers are cached per search). The town→station and
  // places caches stay warm, as for a real user: "cold" here is "a new search", not "an empty server".
  const minute = 10 + Math.floor(Math.random() * 40)
  const times = Array.from({ length: COLD }, (_, i) => `${String(7 + i).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  const q = (time: string) => `from=Fulda&date=2026-11-28&time=${encodeURIComponent(time)}&maxMinutes=120`

  const results: Record<string, { cold: number[]; warm: number[]; caches: string[] }> = {
    health: { cold: [], warm: [], caches: [] },
    stations: { cold: [], warm: [], caches: [] },
    reachable: { cold: [], warm: [], caches: [] },
    destinations: { cold: [], warm: [], caches: [] },
    verdict: { cold: [], warm: [], caches: [] },
  }
  const run = async (name: string, path: string, kind: 'cold' | 'warm') => {
    const r = await timed(path)
    if (r.status !== 200) throw new Error(`${path} answered ${r.status}`)
    results[name][kind].push(r.ms)
    if (r.cache) results[name].caches.push(`${kind}:${r.cache}`)
    const ai = (r.body as { ai?: { status: string } }).ai?.status
    console.log(`${kind.padEnd(4)} ${name.padEnd(12)} ${Math.round(r.ms).toString().padStart(6)} ms${r.cache ? ` x-cache=${r.cache}` : ''}${ai ? ` ai=${ai}` : ''}`)
  }

  for (let i = 0; i < WARM; i++) await run('health', '/api/health', 'warm')
  for (let i = 0; i < WARM; i++) await run('stations', '/api/stations?q=Fulda', 'warm')
  for (const [i, time] of times.entries()) {
    // The order of a real visit: the towns, then the verdict over them.
    await run('reachable', `/api/reachable?${q(time)}`, 'cold')
    await run('destinations', `/api/destinations?${q(time)}`, 'cold')
    await run('verdict', `/api/verdict?${q(time)}`, 'cold')
    for (let k = 0; k < WARM; k++) {
      await run('reachable', `/api/reachable?${q(time)}`, 'warm')
      await run('destinations', `/api/destinations?${q(time)}`, 'warm')
      await run('verdict', `/api/verdict?${q(time)}`, 'warm')
    }
    // Groq's free plan: 8 000 tokens a minute, one verdict ≈ 3 400 - keep new verdicts a minute apart.
    if (i < times.length - 1) await sleep(60_000)
  }

  const table = Object.entries(results).map(([name, r]) => ({
    name,
    cold: r.cold.length ? stats(r.cold) : null,
    warm: r.warm.length ? stats(r.warm) : null,
  }))
  save(process.env.NAME ?? 'timing.json', { cold: COLD, warm: WARM, times, date: '2026-11-28', table, raw: results })

  const f = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`)
  const cell = (s: ReturnType<typeof stats> | null) => (s ? `${f(s.mean)} | ${f(s.median)} | ${f(s.min)}-${f(s.max)} | ${s.n}` : '- | - | - | -')
  console.log(`\nResponse time (${BASE}; Fulda, Sat 28.11.2026, up to 120 min)\n`)
  console.log('| Endpoint | New search: mean | median | min-max | n | Repeated (cache): mean | median | min-max | n |')
  console.log('| -------- | ---: | ---: | ---: | -: | ---: | ---: | ---: | -: |')
  for (const row of table) console.log(`| \`/api/${row.name}\` | ${cell(row.cold)} | ${cell(row.warm)} |`)
}

const what = process.argv[2]
if (what === 'routes') await routes()
else if (what === 'timing') await timing()
else {
  console.error('Usage: npm run measure -w server -- routes | timing')
  process.exit(2)
}
