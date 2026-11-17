import { describe, expect, it } from 'vitest'
import type { Destination, Place } from '../api/types'
import { bahnSearchUrl } from './bahn'
import { chooseMood, pickLine } from './mood'
import { earnedBadges, levelOf, levelStart, toggleStep, totalXp, visitedTowns, type Progress, type QuestInfo } from './progress'
import { generatedQuest, isFoodStep, questFor, type QuestWords } from './quest'
import { parseRoute, routeUrl } from './router'
import { addMinutes, shortDay, todayBerlin, weekendDays } from './time'
import { weatherKind } from './weather'

describe('time', () => {
  it('offers this weekend; on Saturday today and tomorrow, on Sunday today and the next Saturday', () => {
    expect(weekendDays('2026-11-17')).toEqual(['2026-11-21', '2026-11-22']) // Tuesday
    expect(weekendDays('2026-11-21')).toEqual(['2026-11-21', '2026-11-22']) // Saturday
    expect(weekendDays('2026-11-22')).toEqual(['2026-11-22', '2026-11-28']) // Sunday
  })

  it('takes today in Berlin, not on the device', () => {
    expect(todayBerlin(new Date('2026-11-21T23:30:00Z'))).toBe('2026-11-22') // 00:30 in Berlin
  })

  it('writes short days in Ukrainian and keeps times within the day', () => {
    expect(shortDay('2026-11-21')).toBe('сб 21.11')
    expect(addMinutes('09:35', 75)).toBe('10:50')
    expect(addMinutes('23:30', 90)).toBe('23:59')
  })
})

describe('weather', () => {
  it('turns WMO codes into words', () => {
    expect(weatherKind(0).key).toBe('clear')
    expect(weatherKind(61).key).toBe('rain')
    expect(weatherKind(95).key).toBe('storm')
  })
})

describe('levels', () => {
  it('starts level n at 25·n·(n−1) XP, so the first quest brings level 2', () => {
    expect([1, 2, 3, 4, 5].map(levelStart)).toEqual([0, 50, 150, 300, 500])
    expect(levelOf(0)).toMatchObject({ level: 1, title: 'novice', into: 0, need: 50 })
    expect(levelOf(65)).toMatchObject({ level: 2, title: 'passenger', into: 15, need: 100 })
    expect(levelOf(10_000).title).toBe('legend')
  })
})

const info = (over: Partial<QuestInfo> = {}): QuestInfo => ({
  key: '2026-11-21|hunfeld',
  cityId: 'hunfeld',
  cityName: 'Hünfeld',
  center: { lat: 50.67, lon: 9.77 },
  date: '2026-11-21',
  steps: 2,
  rainy: false,
  early: false,
  ...over,
})
const empty: Progress = { v: 1, since: null, quests: {} }

describe('progress', () => {
  it('adds and takes back XP, and remembers since when', () => {
    const now = new Date('2026-11-21T10:00:00Z')
    let p = toggleStep(empty, info(), 0, { xp: 10 }, now)
    p = toggleStep(p, info(), 1, { xp: 20, category: 'museum' }, now)
    expect(totalXp(p)).toBe(30)
    expect(p.since).toBe('2026-11-21')
    p = toggleStep(p, info(), 1, { xp: 20 }, now)
    expect(totalXp(p)).toBe(10)
  })

  it('counts a town as visited after one step, once', () => {
    let p = toggleStep(empty, info(), 0, { xp: 10 })
    p = toggleStep(p, info({ key: '2026-11-28|hunfeld', date: '2026-11-28' }), 0, { xp: 10 })
    expect(visitedTowns(p).map((t) => t.id)).toEqual(['hunfeld'])
  })

  it('gives badges for what was done', () => {
    let p = toggleStep(empty, info({ rainy: true }), 0, { xp: 10, category: 'historic' })
    expect([...earnedBadges(p)].sort()).toEqual(['castles', 'firstTrain', 'rain'])
    p = toggleStep(p, info({ rainy: true }), 1, { xp: 10 })
    expect(earnedBadges(p).has('questDone')).toBe(true)
    expect(earnedBadges(p).has('earlyBird')).toBe(false)
  })
})

describe('mood', () => {
  const rain = { date: '', code: 61, tempMax: 8, tempMin: 2, precipitationProbability: 70, precipitationMm: 3, windMaxKmh: 10, sunshineHours: 1 }
  it('puts a new level, a problem and a wait before the weather, and the weather before the AI', () => {
    expect(chooseMood({ celebrating: true, lost: true })).toBe('celebrating')
    expect(chooseMood({ lost: true, waiting: true })).toBe('lost')
    expect(chooseMood({ weather: rain, ai: 'excited' })).toBe('rainy')
    expect(chooseMood({ weather: { ...rain, tempMax: 2 }, ai: 'excited' })).toBe('cold')
    expect(chooseMood({ departure: '06:30', ai: 'happy' })).toBe('sleepy')
    expect(chooseMood({ departure: '09:00', ai: 'excited' })).toBe('excited')
    expect(chooseMood({})).toBe('happy')
  })

  it('picks the same line for the same seed', () => {
    const lines = ['a', 'b', 'c']
    expect(pickLine(lines, 'x')).toBe(pickLine(lines, 'x'))
    expect(lines).toContain(pickLine(lines, 'y'))
  })
})

const place = (id: string, category: Place['category'], rating = 2): Place => ({ id, name: id, category, rating, distance: 100, lat: 50, lon: 9 })
const city: Destination = {
  id: 'hunfeld',
  name: 'Hünfeld',
  kind: 'town',
  minutes: 35,
  transfers: 0,
  arrival: '2026-11-21T08:35:00Z',
  station: { id: 's', name: 'Hünfeld Bahnhof', lat: 50.67, lon: 9.77 },
  center: { lat: 50.67, lon: 9.77 },
  weather: null,
  places: [place('m', 'museum', 3), place('c', 'food'), place('k', 'architecture'), place('n', 'nature')],
  sightsTotal: 6,
  score: { total: 60, parts: { trip: 0.7, weather: 0.5, places: 0.6 }, weatherUnknown: true, placesUnknown: false },
}
const words: QuestWords = {
  title: (c) => `Q ${c}`,
  arrival: { title: 'arrive', description: (s) => `from ${s}` },
  place: (c) => c,
  food: { title: 'food', description: 'eat' },
  back: { title: 'back', description: (o) => `to ${o}` },
}

describe('quest', () => {
  it('without the AI builds a day from the places: arrival, sights, a café, the way back', () => {
    const q = generatedQuest(city, 'Fulda', words)
    expect(q.steps.map((s) => s.title)).toEqual(['arrive', 'm', 'k', 'c', 'n', 'back'])
    expect(q.steps[0].time).toBe('09:35')
    const times = q.steps.map((s) => s.time)
    expect([...times].sort()).toEqual(times)
    expect(q.steps.find((s) => s.title === 'c')?.placeId).toBe('c')
  })

  it("uses the AI's quest only for its own town", () => {
    const quest = { cityId: 'hunfeld', title: 'AI', steps: [] }
    const verdict = { top: [], comparison: '', warnings: [], quest, character: { mood: 'happy' as const, line: '' } }
    expect(questFor(city, verdict, 'Fulda', words).byAi).toBe(true)
    expect(questFor({ ...city, id: 'other' }, verdict, 'Fulda', words).byAi).toBe(false)
  })

  it('knows a lunch step by its place or its words', () => {
    expect(isFoodStep({ time: '12:00', title: 'Café X', placeId: 'c', description: '', xp: 10 }, city.places)).toBe(true)
    expect(isFoodStep({ time: '12:00', title: 'Обід у центрі', description: '', xp: 10 }, [])).toBe(true)
    expect(isFoodStep({ time: '12:00', title: 'Музей', placeId: 'm', description: '', xp: 10 }, city.places)).toBe(false)
  })
})

describe('router', () => {
  const search = { from: 'Fulda', date: '2026-11-21', time: '09:00', maxMinutes: 120 }
  it('keeps a search in the URL and reads it back', () => {
    expect(parseRoute(routeUrl({ name: 'results', search }))).toEqual({ name: 'results', search })
    expect(parseRoute(routeUrl({ name: 'quest', search, cityId: 'hunfeld' }))).toEqual({ name: 'quest', search, cityId: 'hunfeld' })
    const point = { from: '', lat: 50.55, lon: 9.68, date: '2026-11-21', time: '09:00', maxMinutes: 60 }
    expect(parseRoute(routeUrl({ name: 'results', search: point }))).toEqual({ name: 'results', search: point })
  })

  it('falls back to the search screen for a broken link', () => {
    expect(parseRoute('/results?from=Fulda&date=21.11&time=09:00&maxMinutes=120')).toEqual({ name: 'search' })
    expect(parseRoute('/results?from=Fulda&date=2026-11-21&time=09:00&maxMinutes=999')).toEqual({ name: 'search' })
    expect(parseRoute('/nowhere')).toEqual({ name: 'search' })
  })

  it('makes clean URLs and still reads the old #/ ones', () => {
    expect(routeUrl({ name: 'results', search })).toBe('/results?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120')
    expect(routeUrl({ name: 'progress' })).toBe('/progress')
    expect(parseRoute('#/progress')).toEqual({ name: 'progress' })
    expect(parseRoute('/progress/')).toEqual({ name: 'progress' })
  })
})

describe('bahn.de', () => {
  it('opens the timetable from the town back home at the end of the day', () => {
    const url = new URL(bahnSearchUrl('Hünfeld', 'Fulda', '2026-11-21', '16:00'))
    const hash = new URLSearchParams(url.hash.slice(1))
    expect(url.host).toBe('www.bahn.de')
    expect(hash.get('so')).toBe('Hünfeld')
    expect(hash.get('zo')).toBe('Fulda')
    expect(hash.get('hd')).toBe('2026-11-21T16:00:00')
  })
})
