// Fixes after the step 06 review: the quest over midnight, short caching on gaps, the AI time budget and call limit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, Verdict } from './ai/types.js'
import type { Destination, Destinations, DestinationService } from './destinations.js'
import { checkVerdict, minutesAfter, VerdictService, type Candidate } from './verdict.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ---- checkVerdict: the day goes forward, also past midnight ------------------------------------------

const verdictWith = (times: string[]): Verdict => ({
  top: [{ id: 'alpha', reason: 'Найближче.' }],
  comparison: 'Одне місто.',
  warnings: [],
  quest: {
    cityId: 'alpha',
    title: 'Нічний квест',
    steps: times.map((time, i) => ({ time, title: `Крок ${i + 1}`, description: 'Ідемо далі.', xp: 10 })),
  },
  character: { mood: 'happy', line: 'Поїхали!' },
})

const arrivingAt = (arrival: string): Candidate[] => [{ id: 'alpha', arrival, places: [] } as unknown as Candidate]

describe('minutesAfter', () => {
  it.each([
    ['23:10', '00:20', 70],
    ['09:00', '09:00', 0],
    ['09:00', '10:30', 90],
    ['09:00', '08:59', 1439],
    ['00:00', '23:59', 1439],
  ])('%s → %s is %i minutes', (from, to, minutes) => {
    expect(minutesAfter(from, to)).toBe(minutes)
  })
})

describe('checkVerdict - Ukrainian texts', () => {
  it('rejects letters Ukrainian does not use (a transliterated "Лаутершлёсчен")', () => {
    const v = verdictWith(['09:00', '10:00', '11:00'])
    v.quest.steps[1].title = 'Лаутершлёсчен'
    const { verdict, problems } = checkVerdict(JSON.stringify(v), arrivingAt('09:00'))
    expect(verdict).toBeNull()
    expect(problems).toEqual([expect.stringMatching(/^quest\.steps\.1\.title: letters that are not Ukrainian/)])
  })

  it('accepts German place names with umlauts as given', () => {
    const v = verdictWith(['09:00', '10:00', '11:00'])
    v.quest.steps[1].title = 'Прогулянка до Lauterschlösschen'
    expect(checkVerdict(JSON.stringify(v), arrivingAt('09:00')).problems).toEqual([])
  })
})

describe('checkVerdict - before the arrival', () => {
  it('rejects a quest at 00:30-01:00 for a train arriving at 09:00 (no day trip runs round the clock)', () => {
    const { verdict, problems } = checkVerdict(JSON.stringify(verdictWith(['00:30', '00:45', '01:00'])), arrivingAt('09:00'))
    expect(verdict).toBeNull()
    expect(problems).toContain('quest starts at 00:30, before the arrival at 09:00')
  })
})

describe('checkVerdict - a late arrival', () => {
  it('accepts a quest 23:10, 23:40, 00:20 for a city reached at 23:10', () => {
    const { verdict, problems } = checkVerdict(JSON.stringify(verdictWith(['23:10', '23:40', '00:20'])), arrivingAt('23:10'))
    expect(problems).toEqual([])
    expect(verdict).not.toBeNull()
  })

  it('rejects a quest that starts at 08:00 when the train arrives at 09:00', () => {
    const { verdict, problems } = checkVerdict(JSON.stringify(verdictWith(['08:00', '10:00', '12:00'])), arrivingAt('09:00'))
    expect(verdict).toBeNull()
    expect(problems.join(' ')).toMatch(/before the arrival at 09:00/)
  })

  it('rejects steps out of order, also around midnight', () => {
    const { verdict, problems } = checkVerdict(JSON.stringify(verdictWith(['23:10', '00:20', '23:40'])), arrivingAt('23:10'))
    expect(verdict).toBeNull()
    expect(problems.join(' ')).toMatch(/time order/)
  })
})

// ---- VerdictService with a fake DestinationService ------------------------------------------------------

function city(id: string, name: string): Destination {
  return {
    id,
    name,
    kind: 'town',
    minutes: 30,
    transfers: 0,
    arrival: '2026-11-21T08:30:00Z',
    station: { id, name, lat: 50.1, lon: 9.5 },
    center: { lat: 50.1, lon: 9.5 },
    weather: null,
    places: [],
    sightsTotal: null,
    score: { total: 50 },
  } as unknown as Destination
}

function fakeDestinations(localityFailures = 0): DestinationService & { destinations: ReturnType<typeof vi.fn> } {
  const result = {
    origin: { id: 'o', name: 'Fulda', lat: 50.55, lon: 9.68, locality: 'Fulda' },
    departure: '2026-11-21T08:00:00.000Z',
    maxMinutes: 120,
    date: '2026-11-21',
    weights: {},
    cities: [city('alpha', 'Alpha'), city('beta', 'Beta')],
    stats: { stops: 2, railStops: 2, stations: 2, localityLookups: 2, localityFailures },
    enrichment: {
      weather: 'ok',
      weatherSource: 'w',
      placesSource: 'p',
      placesFailures: 0,
      placesSkipped: 0,
      placesPaused: false,
    },
  } as unknown as Destinations
  return { destinations: vi.fn(async () => ({ result, cached: false })) } as unknown as DestinationService & {
    destinations: ReturnType<typeof vi.fn>
  }
}

const query = {
  origin: { id: 'o', name: 'Fulda', lat: 50.55, lon: 9.68 },
  departure: new Date('2026-11-21T08:00:00Z'),
  maxMinutes: 120,
}

const goodAnswer = JSON.stringify({
  ...verdictWith(['09:30', '10:30', '12:00']),
  top: [
    { id: 'alpha', reason: 'Найближче.' },
    { id: 'beta', reason: 'Теж добре.' },
  ],
})

describe('VerdictService - caching on incomplete data', () => {
  it.each([
    ['with a locality failure: kept only for failureTtlMs', 1, false],
    ['on complete data: kept for ttlMs', 0, true],
  ])('%s', async (_name, failures, cachedAfterShortTtl) => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const destinations = fakeDestinations(failures)
    const service = new VerdictService({ destinations, ai: null, ttlMs: 3600_000, failureTtlMs: 1000, now: () => now })
    await service.verdict(query)
    now += 500
    expect((await service.verdict(query)).cached).toBe(true)
    now += 1000 // past failureTtlMs, far from ttlMs
    expect((await service.verdict(query)).cached).toBe(cachedAfterShortTtl)
  })
})

describe('VerdictService - the AI time budget', () => {
  it('aborts an AI call past the budget and falls back to the ranking, without throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let seen: AbortSignal | undefined
    const ai: AiProvider = {
      name: 'slow-ai',
      model: 'm',
      completeJson: vi.fn(
        (_messages, signal) =>
          new Promise<string>((_resolve, reject) => {
            seen = signal
            signal?.addEventListener('abort', () => reject(signal.reason))
          }),
      ),
    }
    const service = new VerdictService({ destinations: fakeDestinations(), ai, aiBudgetMs: 30 })
    const { result } = await service.verdict(query)

    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen?.aborted).toBe(true)
    expect(result.ai.status).toBe('unavailable')
    expect(result.verdict).toBeNull()
    expect(result.fallback).toEqual(['alpha', 'beta'])
    expect(result.ai.problems).toContain('the AI did not answer in time')
    expect(ai.completeJson).toHaveBeenCalledTimes(1)

    // Slow once is not broken: the next search asks the AI again (no pause for everybody).
    await service.verdict({ ...query, departure: new Date('2026-11-21T09:00:00Z') })
    expect(ai.completeJson).toHaveBeenCalledTimes(2)
  })
})

describe('VerdictService - AI calls per minute', () => {
  it('gives the ranking without calling the AI once the minute is used up', async () => {
    let now = 0
    const ai: AiProvider = { name: 'fake-ai', model: 'm', completeJson: vi.fn(async () => goodAnswer) }
    const service = new VerdictService({ destinations: fakeDestinations(), ai, aiCallsPerMinute: 1, now: () => now })

    expect((await service.verdict(query)).result.ai.status).toBe('ok')
    const other = { ...query, departure: new Date('2026-11-21T09:00:00Z') }
    const limited = await service.verdict(other)
    expect(limited.result.ai).toMatchObject({ status: 'unavailable', problems: ['too many AI calls this minute'] })
    expect(limited.result.fallback).toEqual(['alpha', 'beta'])
    expect(ai.completeJson).toHaveBeenCalledTimes(1)

    now = 60_000
    const later = { ...query, departure: new Date('2026-11-21T10:00:00Z') }
    expect((await service.verdict(later)).result.ai.status).toBe('ok')
    expect(ai.completeJson).toHaveBeenCalledTimes(2)
  })
})
