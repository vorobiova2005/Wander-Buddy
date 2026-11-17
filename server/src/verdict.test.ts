import { describe, expect, it, vi } from 'vitest'
import { Groq } from './ai/groq.js'
import { VERDICT_JSON_SCHEMA, VerdictSchema, type AiProvider, type Verdict } from './ai/types.js'
import { createApp } from './app.js'
import { DestinationService } from './destinations.js'
import { ReachabilityService } from './reachability.js'
import { UpstreamError, type Coordinates, type Locality } from './transit/types.js'
import { checkVerdict, localTime, SYSTEM_PROMPT, VerdictService, type Candidate } from './verdict.js'

// ---- a whole fake pipeline: two towns, weather, places -------------------------------------------------

const NEAR = { lat: 50.67, lon: 9.77 }
const FAR = { lat: 50.34, lon: 9.52 }

function pipeline(options: { weatherDown?: boolean } = {}) {
  const reachability = new ReachabilityService({
    transit: {
      name: 'fake',
      findStations: async (text) => (text === 'Fulda' ? [{ id: 'f', name: 'Fulda', lat: 50.55, lon: 9.68, country: 'DE' }] : []),
      reachableStops: async () => [
        { id: 'h', name: 'Hünfeld Bahnhof', ...NEAR, minutes: 35, vehicles: 1, arrival: '2026-11-21T08:35:00Z', rail: true },
        { id: 's', name: 'Schlüchtern Bahnhof', ...FAR, minutes: 42, vehicles: 1, arrival: '2026-11-21T08:42:00Z', rail: true },
      ],
    },
    locality: {
      name: 'fake',
      localityAt: async (p: Coordinates): Promise<Locality | null> =>
        p.lat === NEAR.lat ? { name: 'Hünfeld', kind: 'town' } : p.lat === FAR.lat ? { name: 'Schlüchtern', kind: 'town' } : { name: 'Fulda', kind: 'town' },
    },
  })
  const destinations = new DestinationService({
    reachability,
    weather: {
      name: 'w',
      horizonDays: 15,
      daily: async (pts) => {
        if (options.weatherDown) throw new UpstreamError('w', 'down')
        return pts.map(() => null)
      },
    },
    places: {
      name: 'p',
      near: async (p) => ({
        places: [{ id: p.lat === NEAR.lat ? 'otm:ZUSE' : 'otm:KLOSTER', name: 'Sight', category: 'museum', rating: 3, distance: 100, lat: 0, lon: 0 }],
        sightsTotal: 6,
      }),
    },
    today: () => '2026-11-17',
  })
  return { reachability, destinations }
}

const destinations = () => pipeline().destinations

const query = {
  origin: { id: 'f', name: 'Fulda', lat: 50.55, lon: 9.68 },
  departure: new Date('2026-11-21T08:00:00Z'),
  maxMinutes: 120,
}

const goodVerdict: Verdict = {
  top: [
    { id: 'hunfeld', reason: 'Найближче і є музей.' },
    { id: 'schluchtern', reason: 'Трохи далі, теж гарно.' },
  ],
  comparison: 'Hünfeld ближче, Schlüchtern має монастир.',
  warnings: [{ text: 'Перевірте поїзд назад увечері.' }],
  quest: {
    cityId: 'hunfeld',
    title: 'Квест у Hünfeld',
    steps: [
      { time: '09:35', title: 'Прибуття', description: 'Виходимо з вокзалу.', xp: 10 },
      { time: '10:00', title: 'Музей', placeId: 'otm:ZUSE', description: 'Історія комп’ютерів.', xp: 20 },
      { time: '12:30', title: 'Обід', description: 'Кава і щось смачне.', xp: 15 },
    ],
  },
  character: { mood: 'happy', line: 'Поїхали!' },
}

function aiAnswering(...answers: (string | Error)[]): AiProvider & { completeJson: ReturnType<typeof vi.fn> } {
  const queue = [...answers]
  return {
    name: 'fake-ai',
    model: 'm',
    completeJson: vi.fn(async () => {
      const next = queue.shift()
      if (next instanceof Error) throw next
      return next ?? JSON.stringify(goodVerdict)
    }),
  }
}

// ---- the checks ------------------------------------------------------------------------------------

const candidates: Candidate[] = [
  { id: 'hunfeld', places: [{ id: 'otm:ZUSE', name: 'Zuse', category: 'museum' }] } as Candidate,
  { id: 'schluchtern', places: [{ id: 'otm:KLOSTER', name: 'Kloster', category: 'architecture' }] } as Candidate,
]

describe('checkVerdict', () => {
  it('accepts an answer that follows the schema and uses only given ids', () => {
    expect(checkVerdict(JSON.stringify(goodVerdict), candidates)).toEqual({ verdict: goodVerdict, problems: [] })
  })

  it('rejects text that is not JSON', () => {
    expect(checkVerdict('Sure! Here is the plan...', candidates).problems).toEqual(['the answer is not JSON'])
  })

  it('rejects an answer that breaks the schema and says where', () => {
    const bad = { ...goodVerdict, quest: { ...goodVerdict.quest, steps: [{ time: '25:00', title: 'x', description: 'y', xp: 1 }] } }
    const { verdict, problems } = checkVerdict(JSON.stringify(bad), candidates)
    expect(verdict).toBeNull()
    expect(problems.join(' ')).toMatch(/quest\.steps/)
  })

  it.each([
    ['an invented city', { ...goodVerdict, top: [{ id: 'atlantis', reason: 'x' }] }, /unknown city id "atlantis"/],
    ['the same city twice', { ...goodVerdict, top: [goodVerdict.top[0], goodVerdict.top[0]] }, /the same city twice/],
    ['a quest in another city', { ...goodVerdict, quest: { ...goodVerdict.quest, cityId: 'schluchtern' } }, /first of top/],
    [
      "a place of another city",
      {
        ...goodVerdict,
        quest: { ...goodVerdict.quest, steps: goodVerdict.quest.steps.map((s) => ({ ...s, placeId: 'otm:KLOSTER' })) },
      },
      /not a place of hunfeld/,
    ],
    ['a warning about an unknown city', { ...goodVerdict, warnings: [{ id: 'mars', text: 'x' }] }, /unknown city id "mars"/],
  ])('rejects %s', (_name, bad, problem) => {
    const { verdict, problems } = checkVerdict(JSON.stringify(bad), candidates)
    expect(verdict).toBeNull()
    expect(problems.join(' ')).toMatch(problem)
  })
})

describe('checkVerdict - ids stay in the id fields', () => {
  const steps = goodVerdict.quest.steps
  it.each([
    ['a place id in a step', { ...goodVerdict, quest: { ...goodVerdict.quest, steps: [steps[0], { ...steps[1], description: 'Відвідайте otm:ZUSE - музей.' }, steps[2]] } }, /quest\.steps\.1\.description: an id/],
    ['an unknown place id', { ...goodVerdict, comparison: 'Там є otm:N123.' }, /comparison: an id/],
    ['a city id', { ...goodVerdict, top: [{ id: 'hunfeld', reason: 'hunfeld найближче.' }, goodVerdict.top[1]] }, /top\.0\.reason: an id/],
    ['a city id in the character line', { ...goodVerdict, character: { mood: 'happy', line: 'До schluchtern!' } }, /character\.line/],
  ])('rejects %s', (_name, bad, problem) => {
    const { verdict, problems } = checkVerdict(JSON.stringify(bad), candidates)
    expect(verdict).toBeNull()
    expect(problems.join(' ')).toMatch(problem)
  })

  it('accepts names that only look like ids (Hünfeld, Hunfelder, a German word)', () => {
    const ok = { ...goodVerdict, comparison: 'Hünfeld і Hunfelder Altstadt - поруч; Schlüchtern далі.' }
    expect(checkVerdict(JSON.stringify(ok), candidates).problems).toEqual([])
  })
})

describe('prompt: texts for people', () => {
  it('asks for names in the texts and a plan in the future', () => {
    expect(SYSTEM_PROMPT).toMatch(/never an id/)
    expect(SYSTEM_PROMPT).toMatch(/never in the past tense/)
  })
})

describe('checkVerdict - the day goes forward', () => {
  const withArrival = [{ ...candidates[0], arrival: '09:35' }, candidates[1]]
  const steps = goodVerdict.quest.steps

  it('rejects steps out of time order', () => {
    const bad = { ...goodVerdict, quest: { ...goodVerdict.quest, steps: [steps[0], steps[2], steps[1]] } }
    expect(checkVerdict(JSON.stringify(bad), withArrival).problems.join(' ')).toMatch(/time order/)
  })

  it('rejects a quest that starts before the train arrives', () => {
    const early = { ...goodVerdict, quest: { ...goodVerdict.quest, steps: [{ ...steps[0], time: '08:00' }, ...steps.slice(1)] } }
    expect(checkVerdict(JSON.stringify(early), withArrival).problems.join(' ')).toMatch(/before the arrival at 09:35/)
  })

  it('accepts a quest that starts on arrival', () => {
    expect(checkVerdict(JSON.stringify(goodVerdict), withArrival).verdict).not.toBeNull()
  })
})

describe('VerdictService', () => {
  it('returns the checked AI verdict over the best candidates', async () => {
    const ai = aiAnswering()
    const { result } = await new VerdictService({ destinations: destinations(), ai }).verdict(query)
    expect(result.ai).toEqual({ status: 'ok', provider: 'fake-ai', model: 'm', problems: [] })
    expect(result.verdict).toEqual(goodVerdict)
    expect(result.candidates.map((c) => [c.id, c.arrival])).toEqual([
      ['hunfeld', '09:35'],
      ['schluchtern', '09:42'],
    ])
    // The AI is given the candidates with their ids and the schema.
    const [system, user] = ai.completeJson.mock.calls[0][0]
    expect(system.content).toContain('"quest"')
    expect(JSON.parse(user.content).candidates[0]).toMatchObject({ id: 'hunfeld', places: [{ id: 'otm:ZUSE' }] })
  })

  it('without an AI gives the computed ranking, not an error', async () => {
    const { result } = await new VerdictService({ destinations: destinations(), ai: null }).verdict(query)
    expect(result).toMatchObject({ verdict: null, fallback: ['hunfeld', 'schluchtern'], ai: { status: 'disabled' } })
  })

  it('when the AI is down gives the computed ranking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ai = aiAnswering(new UpstreamError('fake-ai', 'HTTP 503'))
    const { result } = await new VerdictService({ destinations: destinations(), ai }).verdict(query)
    expect(result).toMatchObject({ verdict: null, fallback: ['hunfeld', 'schluchtern'], ai: { status: 'unavailable' } })
    warn.mockRestore()
  })

  it('asks again once, telling the AI what was wrong; uses the second answer if it is right', async () => {
    const ai = aiAnswering('not json', JSON.stringify(goodVerdict))
    const { result } = await new VerdictService({ destinations: destinations(), ai }).verdict(query)
    expect(result.ai.status).toBe('ok')
    expect(ai.completeJson).toHaveBeenCalledTimes(2)
    const retry = ai.completeJson.mock.calls[1][0].at(-1)
    expect(retry.content).toMatch(/could not be used: the answer is not JSON/)
  })

  it('gives up after two wrong answers and reports the problems', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wrong = JSON.stringify({ ...goodVerdict, top: [{ id: 'atlantis', reason: 'x' }] })
    const ai = aiAnswering(wrong, wrong)
    const { result } = await new VerdictService({ destinations: destinations(), ai }).verdict(query)
    expect(result.verdict).toBeNull()
    expect(result.ai.status).toBe('invalid')
    expect(result.ai.problems.join(' ')).toMatch(/atlantis/)
    warn.mockRestore()
  })

  it('reuses a verdict and shares one AI call between identical requests', async () => {
    const ai = aiAnswering()
    const service = new VerdictService({ destinations: destinations(), ai })
    await Promise.all([service.verdict(query), service.verdict(query)])
    const again = await service.verdict(query)
    expect(again.cached).toBe(true)
    expect(ai.completeJson).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/verdict', () => {
  const app = (ai: AiProvider | null) => {
    const { reachability, destinations: dest } = pipeline()
    return createApp({ reachability, destinations: dest, verdicts: new VerdictService({ destinations: dest, ai }) })
  }

  it('without a Groq key answers 200 with the ranking and no verdict (the step 06 criterion)', async () => {
    const res = await app(null).request('/api/verdict?from=Fulda&date=2026-11-21&time=09:00')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, verdict: null, ai: { status: 'disabled' }, fallback: ['hunfeld', 'schluchtern'] })
  })

  it('with an AI answers the verdict that passes the schema', async () => {
    const res = await app(aiAnswering()).request('/api/verdict?from=Fulda&date=2026-11-21&time=09:00')
    const body = await res.json()
    expect(VerdictSchema.safeParse(body.verdict).success).toBe(true)
  })
})

describe('Groq', () => {
  it('asks for JSON mode with the chosen model, sends the key only in the header', async () => {
    const f = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] })),
    )
    const groq = new Groq({ apiKey: 'secret-key', model: 'openai/gpt-oss-120b', userAgent: 'T', fetch: f as unknown as typeof fetch })
    expect(await groq.completeJson([{ role: 'user', content: 'hi' }])).toBe('{"a":1}')
    const [url, init] = f.mock.calls[0]
    expect(String(url)).not.toContain('secret-key')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-key')
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'openai/gpt-oss-120b', response_format: { type: 'json_object' } })
  })

  it('turns errors into UpstreamError without the key in the message', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 429 }))
    const groq = new Groq({ apiKey: 'secret-key', model: 'm', userAgent: 'T', fetch: f as unknown as typeof fetch })
    const err = await groq.completeJson([]).catch((e) => e)
    expect(err).toBeInstanceOf(UpstreamError)
    expect(String(err.message)).not.toContain('secret-key')
  })
})

describe('prompt and helpers', () => {
  it('gives the model the JSON Schema of the verdict', () => {
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(VERDICT_JSON_SCHEMA))
  })

  it('shows times in Berlin local time', () => {
    expect(localTime('2026-11-21T08:35:00Z')).toBe('09:35')
    expect(localTime('2026-07-04T08:35:00Z')).toBe('10:35')
    expect(localTime('')).toBe('')
  })
})

describe('VerdictService - protecting the data and the quota', () => {
  it('keeps a verdict on incomplete data (no weather) only briefly, and says the data was incomplete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const ai = aiAnswering()
    const service = new VerdictService({ destinations: pipeline({ weatherDown: true }).destinations, ai })
    const first = await service.verdict(query)
    expect(first.result.enrichment.weather).toBe('unavailable')
    now += 60_000
    expect((await service.verdict(query)).cached).toBe(true)
    now += 2 * 60_000 // past the short time to live
    expect((await service.verdict(query)).cached).toBe(false)
    vi.restoreAllMocks()
    warn.mockRestore()
  })

  it('after the AI fails, nobody asks it for a while - every search gets the ranking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 0
    const ai = aiAnswering(new UpstreamError('fake-ai', 'HTTP 429'))
    const service = new VerdictService({ destinations: destinations(), ai, pauseMs: 60_000, now: () => now })
    await service.verdict(query)
    const other = { ...query, departure: new Date('2026-11-21T09:00:00Z') } // another key, not in the cache
    const paused = await service.verdict(other)
    expect(paused.result.ai.status).toBe('unavailable')
    expect(paused.result.fallback.length).toBeGreaterThan(0)
    expect(ai.completeJson).toHaveBeenCalledTimes(1)

    now = 61_000 // the pause is over
    const later = { ...query, departure: new Date('2026-11-21T10:00:00Z') }
    expect((await service.verdict(later)).result.ai.status).toBe('ok')
    expect(ai.completeJson).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('Groq - quota friendly', () => {
  it('asks gpt-oss models to reason little, and not other models', async () => {
    const body = async (model: string) => {
      const f = vi.fn(async (_i: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })),
      )
      await new Groq({ apiKey: 'k', model, userAgent: 'T', fetch: f as unknown as typeof fetch }).completeJson([])
      return JSON.parse(String(f.mock.calls[0][1]?.body))
    }
    expect((await body('openai/gpt-oss-120b')).reasoning_effort).toBe('low')
    expect((await body('qwen/qwen3.8-27b')).reasoning_effort).toBeUndefined()
  })
})
