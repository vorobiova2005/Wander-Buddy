import { TtlCache } from './cache.js'
import { VERDICT_JSON_SCHEMA, VerdictSchema, type AiProvider, type ChatMessage, type Verdict } from './ai/types.js'
import type { Destination, DestinationService, Destinations } from './destinations.js'
import type { ReachabilityQuery } from './reachability.js'
import type { Weights } from './scoring.js'

/**
 * Data → computation → AI. The formula ranks; the AI explains, compares, warns and plans the day - choosing only
 * among the candidates and naming them by id. Its answer is checked against VerdictSchema and the ids; anything
 * wrong or unavailable → the computed ranking without the AI (never an error for the user).
 */

/** What the AI sees about one destination - compact, with ids. */
export type Candidate = {
  id: string
  name: string
  kind: Destination['kind']
  minutes: number
  transfers: number
  /** Arrival, local time HH:MM. */
  arrival: string
  station: string
  score: Destination['score']
  weather: {
    code: number
    tempMin: number
    tempMax: number
    rainChance: number | null
    sunshineHours: number
  } | null
  sightsTotal: number | null
  places: { id: string; name: string; category: string }[]
}

/** ok - verdict checked; disabled - no AI configured; unavailable - the AI failed; invalid - it answered wrongly twice. */
export type AiStatus = 'ok' | 'disabled' | 'unavailable' | 'invalid' | 'no_candidates'

export type VerdictAnswer = {
  origin: Destinations['origin']
  date: string
  departure: string
  maxMinutes: number
  weights: Weights
  candidates: Candidate[]
  /** The checked AI verdict, or null - then `fallback` is the answer. */
  verdict: Verdict | null
  /** The ranking by the formula alone (candidate ids, best first): what the UI shows without a verdict. */
  fallback: string[]
  /** How complete the data under the candidates was (weather, places) - "no weather" is not "nice weather". */
  enrichment: Destinations['enrichment']
  ai: { status: AiStatus; provider: string | null; model: string | null; problems: string[] }
}

type Deps = {
  destinations: DestinationService
  ai: AiProvider | null
  /** How many of the best towns the AI chooses from. */
  candidates?: number
  /** A checked verdict on complete data is reused this long (the free plan has 1 000 requests a day). */
  ttlMs?: number
  /** A failed verdict, or one on incomplete data, is kept only this long. */
  failureTtlMs?: number
  /** After the AI fails (429, down), nobody asks it for this long - the free plan has 8 000 tokens a minute. */
  pauseMs?: number
  now?: () => number
}

export class VerdictService {
  private readonly cache: TtlCache<VerdictAnswer>
  private readonly inflight = new Map<string, Promise<VerdictAnswer>>()
  /** AI-wide breaker: until this moment every request gets the ranking without asking the AI. */
  private pausedUntil = 0

  constructor(private readonly deps: Deps) {
    this.cache = new TtlCache(deps.ttlMs ?? 6 * 3600_000, 500)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  async verdict(query: ReachabilityQuery): Promise<{ result: VerdictAnswer; cached: boolean }> {
    const key = [
      this.deps.ai ? `${this.deps.ai.name}:${this.deps.ai.model}` : 'none',
      `${query.origin.lat.toFixed(3)},${query.origin.lon.toFixed(3)}`,
      query.departure.toISOString(),
      query.maxMinutes,
    ].join('|')
    const hit = this.cache.get(key)
    if (hit) return { result: hit, cached: true }
    const running = this.inflight.get(key)
    if (running) return { result: await running, cached: false }
    const work = this.compute(query, key).finally(() => this.inflight.delete(key))
    this.inflight.set(key, work)
    return { result: await work, cached: false }
  }

  private async compute(query: ReachabilityQuery, key: string): Promise<VerdictAnswer> {
    const { result: dest } = await this.deps.destinations.destinations(query, { villages: false })
    const candidates = dest.cities.slice(0, this.deps.candidates ?? 5).map(toCandidate)
    const answer: VerdictAnswer = {
      origin: dest.origin,
      date: dest.date,
      departure: dest.departure,
      maxMinutes: dest.maxMinutes,
      weights: dest.weights,
      candidates,
      verdict: null,
      fallback: candidates.map((c) => c.id),
      enrichment: dest.enrichment,
      ai: { status: 'disabled', provider: this.deps.ai?.name ?? null, model: this.deps.ai?.model ?? null, problems: [] },
    }
    // Data with gaps (no weather, places failed or paused) heals in minutes: do not keep a verdict on it for hours.
    const complete =
      dest.enrichment.weather !== 'unavailable' && dest.enrichment.placesFailures === 0 && !dest.enrichment.placesPaused

    if (candidates.length === 0) return this.keep(key, { ...answer, ai: { ...answer.ai, status: 'no_candidates' } }, complete)
    if (!this.deps.ai) return this.keep(key, answer, complete)
    if (this.now() < this.pausedUntil) {
      return this.keep(key, { ...answer, ai: { ...answer.ai, status: 'unavailable', problems: ['the AI is paused after a failure'] } }, false)
    }

    const messages = buildMessages(dest, candidates)
    let problems: string[] = []
    // Two tries: the second one is told what was wrong with the first.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ask = attempt === 1 ? messages : [...messages, retryMessage(problems)]
      let raw: string
      try {
        raw = await this.deps.ai.completeJson(ask)
      } catch (err) {
        const pause = this.deps.pauseMs ?? 60_000
        this.pausedUntil = this.now() + pause
        console.warn(`AI: ${(err as Error).message}; pausing the AI for ${pause / 1000} s`)
        return this.keep(key, { ...answer, ai: { ...answer.ai, status: 'unavailable', problems: [] } }, false)
      }
      const checked = checkVerdict(raw, candidates)
      if (checked.verdict) {
        return this.keep(key, { ...answer, verdict: checked.verdict, ai: { ...answer.ai, status: 'ok', problems: [] } }, complete)
      }
      problems = checked.problems
    }
    console.warn(`AI: invalid verdict twice: ${problems.join('; ')}`)
    return this.keep(key, { ...answer, ai: { ...answer.ai, status: 'invalid', problems } }, false)
  }

  private keep(key: string, answer: VerdictAnswer, good: boolean): VerdictAnswer {
    this.cache.set(key, answer, good ? undefined : (this.deps.failureTtlMs ?? 2 * 60_000))
    return answer
  }
}

/**
 * Is the raw answer a verdict we can show? JSON, the schema, and every id from the candidates: the top towns,
 * the quest city (= the first of the top), the quest's places (of that city), the warnings.
 */
export function checkVerdict(raw: string, candidates: Candidate[]): { verdict: Verdict | null; problems: string[] } {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { verdict: null, problems: ['the answer is not JSON'] }
  }
  const parsed = VerdictSchema.safeParse(data)
  if (!parsed.success) {
    return {
      verdict: null,
      problems: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  const v = parsed.data
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const problems: string[] = []
  const topIds = v.top.map((t) => t.id)
  topIds.filter((id) => !byId.has(id)).forEach((id) => problems.push(`top: unknown city id "${id}"`))
  if (new Set(topIds).size !== topIds.length) problems.push('top: the same city twice')
  if (v.quest.cityId !== topIds[0]) problems.push(`quest.cityId must be the first of top ("${topIds[0]}")`)
  const questCity = byId.get(v.quest.cityId)
  const placeIds = new Set(questCity?.places.map((p) => p.id) ?? [])
  v.quest.steps
    .filter((s) => s.placeId && !placeIds.has(s.placeId))
    .forEach((s) => problems.push(`quest step "${s.title}": place id "${s.placeId}" is not a place of ${v.quest.cityId}`))
  v.warnings
    .filter((w) => w.id && !byId.has(w.id))
    .forEach((w) => problems.push(`warning: unknown city id "${w.id}"`))
  // The day goes forward and starts on arrival (HH:MM compares correctly as text).
  const times = v.quest.steps.map((s) => s.time)
  if (times.some((t, i) => i > 0 && t < times[i - 1])) problems.push('quest steps must be in time order')
  if (questCity?.arrival && times[0] < questCity.arrival) {
    problems.push(`quest starts at ${times[0]}, before the arrival at ${questCity.arrival}`)
  }
  problems.push(...idsInTexts(v, candidates))
  return problems.length ? { verdict: null, problems } : { verdict: v, problems: [] }
}

/**
 * Ids belong in the id fields only: the texts are read by people. Finds a city id, a place id, or anything shaped
 * like a place id (`otm:…`, by the prefixes of the given places) in a text field.
 */
function idsInTexts(v: Verdict, candidates: Candidate[]): string[] {
  const texts: [string, string][] = [
    ...v.top.map((t, i): [string, string] => [`top.${i}.reason`, t.reason]),
    ['comparison', v.comparison],
    ...v.warnings.map((w, i): [string, string] => [`warnings.${i}.text`, w.text]),
    ['quest.title', v.quest.title],
    ...v.quest.steps.flatMap((s, i): [string, string][] => [
      [`quest.steps.${i}.title`, s.title],
      [`quest.steps.${i}.description`, s.description],
    ]),
    ['character.line', v.character.line],
  ]
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefixes = [
    ...new Set(candidates.flatMap((c) => c.places.filter((p) => p.id.includes(':')).map((p) => p.id.split(':')[0] + ':'))),
  ]
  const patterns = [
    // City ids are lowercase slugs ("hunfeld"); names in the texts are written as names ("Hünfeld").
    ...candidates.map((c) => new RegExp(`(?<![\\p{L}\\p{N}-])${escape(c.id)}(?![\\p{L}\\p{N}-])`, 'u')),
    ...prefixes.map((p) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}\\S`, 'u')),
  ]
  return texts
    .filter(([, text]) => patterns.some((re) => re.test(text)))
    .map(([field]) => `${field}: an id in the text - write the name of the place or town, ids go only into the id fields`)
}

export const SYSTEM_PROMPT = `You are Wander Buddy, a cheerful travel companion for international exchange students in Germany.
You help to choose a day trip by regional transport (Deutschland-Ticket) and turn the day into a small quest.

You get the candidates already ranked by a scoring formula: score 0-100 with parts trip, weather and places (0-1 each).
Rules:
- Choose ONLY among the candidates. In the id fields ("id", "cityId", "placeId") use ONLY the ids given.
- Texts are read by people: in every text write the NAMES of towns and places, never an id (no "otm:…", no "hunfeld").
- Write every text in Ukrainian: friendly, short, concrete. The character line may be playful.
- "top": up to 3 destinations, best first. Follow the ranking unless you have a clear reason; if you change it, say why.
- "comparison": how the top destinations differ (trip time, weather, what there is to see).
- "warnings": rain or cold, long trips, transfers; always remind to check the train back in the evening.
- "quest": a plan for the day in the FIRST destination of "top" ("cityId" = its id). Steps start at the arrival time
  given for that city, local times HH:MM in order, 3-8 steps. Put "placeId" on a step at one of that city's places.
  Include a lunch or coffee break (a café if the city has one). "xp" 5-100 per step - more for a bigger effort.
  The quest is a plan for the coming day: write step titles and descriptions as invitations in the imperative or the future tense
  ("Загляньте до музею…", "Піднімемося на…"), never in the past tense ("Відвідали…").
- "character": "mood" one of happy, excited, thoughtful, worried, and one "line" the companion says.
Answer with ONE JSON object that matches this JSON Schema exactly, and nothing else:
${JSON.stringify(VERDICT_JSON_SCHEMA)}`

export function buildMessages(dest: Destinations, candidates: Candidate[]): ChatMessage[] {
  const context = {
    origin: dest.origin.locality ?? dest.origin.name,
    date: dest.date,
    departure: localTime(dest.departure),
    maxMinutes: dest.maxMinutes,
    candidates,
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(context) },
  ]
}

function retryMessage(problems: string[]): ChatMessage {
  return {
    role: 'user',
    content: `Your previous answer could not be used: ${problems.join('; ')}. Answer again with one JSON object that follows the schema and uses only the given ids.`,
  }
}

export function toCandidate(d: Destination): Candidate {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    minutes: d.minutes,
    transfers: d.transfers,
    arrival: localTime(d.arrival),
    station: d.station.name,
    score: d.score,
    weather: d.weather
      ? {
          code: d.weather.code,
          tempMin: d.weather.tempMin,
          tempMax: d.weather.tempMax,
          rainChance: d.weather.precipitationProbability,
          sunshineHours: d.weather.sunshineHours,
        }
      : null,
    sightsTotal: d.sightsTotal,
    places: d.places.slice(0, 8).map((p) => ({ id: p.id, name: p.name, category: p.category })),
  }
}

/** ISO instant → HH:MM in Europe/Berlin; empty for an empty or broken input. */
export function localTime(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(t)
}
