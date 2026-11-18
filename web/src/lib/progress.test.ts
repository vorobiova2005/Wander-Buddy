import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanProgress,
  progressIsStored,
  resetProgress,
  resetProgressCache,
  saveProgress,
  toggleStep,
  totalXp,
  useProgress,
  visitedTowns,
  type Progress,
  type QuestInfo,
} from './progress'

const empty: Progress = { v: 1, since: null, quests: {} }

/** A stored quest as it is written to localStorage - every field valid. */
const storedQuest = (over: Record<string, unknown> = {}) => ({
  key: 'k',
  cityId: 'hunfeld',
  cityName: 'Hünfeld',
  center: { lat: 50.67, lon: 9.77 },
  date: '2026-11-21',
  steps: 3,
  done: { 0: { xp: 10, at: '2026-11-21T09:00:00.000Z' } },
  rainy: true,
  early: false,
  ...over,
})
const step = (over: Record<string, unknown> = {}) => ({ time: '10:00', title: 'Museum', description: 'Look inside.', xp: 20, ...over })

describe('cleanProgress', () => {
  it.each([
    ['null', null],
    ['a string', 'progress'],
    ['an array', []],
    ['another version', { v: 2, since: null, quests: {} }],
    ['quests: null', { v: 1, since: null, quests: null }],
    ['quests as an array', { v: 1, since: null, quests: [] }],
  ])('turns %s into an empty progress', (_, raw) => {
    expect(cleanProgress(raw)).toEqual(empty)
  })

  it.each([
    ['without done', { done: undefined }],
    ['with a string step count', { steps: '3' }],
    ['with a string city id', { cityId: 42 }],
    ['with a broken center', { center: { lat: '50', lon: 9 } }],
    ['without a center', { center: null }],
    ['with done as an array', { done: [] }],
  ])('drops a quest %s', (_, over) => {
    const p = cleanProgress({ v: 1, since: null, quests: { bad: storedQuest(over), good: storedQuest() } })
    expect(Object.keys(p.quests)).toEqual(['good'])
  })

  it('drops a quest that is an empty object instead of crashing', () => {
    expect(cleanProgress({ v: 1, since: null, quests: { x: {} } })).toEqual(empty)
  })

  it('drops a done step with a string, negative or huge xp and keeps the valid ones', () => {
    const done = {
      0: { xp: 10, at: 'a' },
      1: { xp: '20', at: 'b' },
      2: { xp: -5, at: 'c' },
      3: { xp: 5000, at: 'd' },
      4: { xp: 15, at: 'e', category: 'museum' },
      5: { xp: 15 },
    }
    const p = cleanProgress({ v: 1, since: null, quests: { k: storedQuest({ steps: 6, done }) } })
    expect(p.quests.k.done).toEqual({ 0: { xp: 10, at: 'a' }, 4: { xp: 15, at: 'e', category: 'museum' } })
    expect(totalXp(p)).toBe(25)
  })

  it('drops a plan with one broken step but keeps the quest and its ticks', () => {
    const plan = { title: 'Day', byAi: true, steps: [step(), step({ xp: '20' })] }
    const p = cleanProgress({ v: 1, since: null, quests: { k: storedQuest({ plan }) } })
    expect(p.quests.k).toBeDefined()
    expect(p.quests.k.plan).toBeUndefined()
    expect(p.quests.k.done).toEqual({ 0: { xp: 10, at: '2026-11-21T09:00:00.000Z' } })
  })

  it('keeps a valid plan', () => {
    const plan = { title: 'Day', byAi: true, steps: [step(), step({ placeId: 'otm:x' })] }
    const p = cleanProgress({ v: 1, since: null, quests: { k: storedQuest({ plan }) } })
    expect(p.quests.k.plan).toEqual(plan)
  })

  it('keeps best and since when valid and drops them when not', () => {
    const ok = cleanProgress({ v: 1, since: '2026-11-14', best: 3, quests: {} })
    expect(ok).toEqual({ v: 1, since: '2026-11-14', best: 3, quests: {} })
    const bad = cleanProgress({ v: 1, since: 20261114, best: '3', quests: {} })
    expect(bad).toEqual(empty)
    expect(bad).not.toHaveProperty('best')
  })

  it('reads rainy and early only when they are true', () => {
    const p = cleanProgress({ v: 1, since: null, quests: { k: storedQuest({ rainy: 'yes', early: true }) } })
    expect(p.quests.k).toMatchObject({ rainy: false, early: true })
  })
})

const info = (over: Partial<QuestInfo> = {}): QuestInfo => ({
  key: '2026-11-21|hunfeld',
  cityId: 'hunfeld',
  cityName: 'Hünfeld',
  center: { lat: 50.67, lon: 9.77 },
  date: '2026-11-21',
  steps: 3,
  rainy: true,
  early: false,
  ...over,
})

describe('toggleStep fixes the facts of the day at the first tick', () => {
  it('keeps the first tick facts when a later tick comes with other ones', () => {
    let p = toggleStep(empty, info({ rainy: true, early: false }), 0, { xp: 10 })
    p = toggleStep(p, info({ rainy: false, early: true }), 1, { xp: 20 })
    expect(p.quests[info().key]).toMatchObject({ rainy: true, early: false })
  })

  it('takes the new facts after every tick has been undone', () => {
    let p = toggleStep(empty, info({ rainy: true, early: false }), 0, { xp: 10 })
    p = toggleStep(p, info({ rainy: true, early: false }), 1, { xp: 20 })
    p = toggleStep(p, info(), 0, { xp: 10 })
    p = toggleStep(p, info(), 1, { xp: 20 })
    expect(p.quests[info().key].done).toEqual({})
    p = toggleStep(p, info({ rainy: false, early: true }), 2, { xp: 15 })
    expect(p.quests[info().key]).toMatchObject({ rainy: false, early: true })
  })

  it('keeps the first tick facts when a later step is undone', () => {
    let p = toggleStep(empty, info({ rainy: true }), 0, { xp: 10 })
    p = toggleStep(p, info({ rainy: false }), 1, { xp: 20 })
    p = toggleStep(p, info({ rainy: false }), 1, { xp: 20 }) // undo the second; the first still holds the day
    expect(p.quests[info().key].rainy).toBe(true)
  })
})

describe('storage that refuses to keep the progress', () => {
  beforeEach(() => {
    localStorage.clear()
    resetProgressCache()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    saveProgress(empty) // back to a storing browser for the next test
    localStorage.clear()
    resetProgressCache()
  })

  it('keeps the progress in memory, says it is not stored, and a reset empties it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const { result } = renderHook(() => useProgress())
    const next = toggleStep(empty, info(), 0, { xp: 10 })
    act(() => saveProgress(next))
    expect(progressIsStored()).toBe(false)
    expect(result.current).toEqual(next)
    expect(totalXp(result.current)).toBe(10)

    act(() => resetProgress())
    expect(result.current).toEqual(empty)
  })

  it('says it is stored again once a save succeeds', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    saveProgress(empty)
    expect(progressIsStored()).toBe(false)
    spy.mockRestore()
    saveProgress(empty)
    expect(progressIsStored()).toBe(true)
  })

  it('resets without crashing when removing from storage throws', () => {
    saveProgress(toggleStep(empty, info(), 0, { xp: 10 }))
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useProgress())
    act(() => resetProgress())
    expect(result.current).toEqual(empty)
  })
})

describe('cleanProgress - step numbers', () => {
  it('drops ticks on steps the quest does not have, and a broken step count', () => {
    const done = { 0: { xp: 10, at: 'a' }, 2: { xp: 10, at: 'b' }, 7: { xp: 50, at: 'c' }, abc: { xp: 50, at: 'd' }, '-1': { xp: 50, at: 'e' } }
    const p = cleanProgress({ v: 1, since: null, quests: { k: storedQuest({ done }) } })
    expect(Object.keys(p.quests.k.done)).toEqual(['0', '2'])
    expect(totalXp(p)).toBe(20)
    expect(cleanProgress({ v: 1, since: null, quests: { k: storedQuest({ steps: 2.5 }) } }).quests).toEqual({})
  })
})

describe('visitedTowns', () => {
  const quest = (key: string, cityId: string, cityName: string, lat: number, date: string) =>
    storedQuest({ key, cityId, cityName, center: { lat, lon: 9.61 }, date })

  it('keeps two towns with the same name apart and counts one town once whatever its id', () => {
    const p = cleanProgress({
      v: 1,
      since: null,
      quests: {
        a: quest('a', 'neuhof', 'Neuhof', 50.45, '2026-11-21'),
        b: quest('b', 'neuhof-5045-961', 'Neuhof', 50.45, '2026-11-28'), // the same town, another id
        c: quest('c', 'neuhof-5135-961', 'Neuhof', 51.35, '2026-11-22'), // another Neuhof
      },
    })
    expect(visitedTowns(p).map((t) => [t.id, t.date])).toEqual([
      ['neuhof-5045-961', '2026-11-28'],
      ['neuhof-5135-961', '2026-11-22'],
    ])
  })
})
