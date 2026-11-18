import { useSyncExternalStore } from 'react'
import type { Coordinates, PlaceCategory, QuestStep } from '../api/types'
import { todayBerlin } from './time'

/**
 * The player's progress - experience, level, visited towns, badges. Only in this browser (localStorage), no
 * accounts (coursework scope). A step can be undone: a misclick must not cost or give XP for good.
 */

export type DoneStep = { xp: number; at: string; category?: PlaceCategory }

export type QuestRecord = {
  key: string
  cityId: string
  cityName: string
  center: Coordinates
  date: string
  steps: number
  done: Record<number, DoneStep>
  /** Facts of the trip day the badges need. */
  rainy: boolean
  early: boolean
  /** The plan the ticks belong to (step numbers point into it); kept so a later AI answer cannot reshuffle them. */
  plan?: { title: string; byAi: boolean; steps: QuestStep[] }
}

export type Progress = {
  v: 1
  since: string | null
  quests: Record<string, QuestRecord>
  /** The highest level already celebrated - a level-up shows once, not again after an undo and redo. */
  best?: number
}

const KEY = 'wb.progress.v1'
const EMPTY: Progress = { v: 1, since: null, quests: {} }

// ---- levels -----------------------------------------------------------------------------------------

/**
 * Level n starts at 25·n·(n−1) XP: 0, 50, 150, 300, 500, 750 … - each level asks 50 XP more than the last, so the
 * first quest (≈ 90 XP) already brings level 2.
 */
export const levelStart = (level: number) => 25 * level * (level - 1)

export const LEVEL_TITLES = ['novice', 'passenger', 'wanderer', 'explorer', 'pathfinder', 'legend'] as const

export function levelOf(xp: number) {
  let level = 1
  while (xp >= levelStart(level + 1)) level++
  const start = levelStart(level)
  const next = levelStart(level + 1)
  return {
    level,
    title: LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length) - 1],
    into: xp - start,
    need: next - start,
  }
}

// ---- derived ----------------------------------------------------------------------------------------

export const totalXp = (p: Progress) =>
  Object.values(p.quests).reduce((sum, q) => sum + Object.values(q.done).reduce((s, d) => s + d.xp, 0), 0)

/**
 * Towns with at least one quest step done, latest first. A town is its name and where it is (to a tenth of a degree),
 * not its id: two towns called "Neuhof" stay two, and one town counts once whatever id a search gave it.
 */
export function visitedTowns(p: Progress) {
  const byCity = new Map<string, { id: string; name: string; center: Coordinates; date: string }>()
  for (const q of Object.values(p.quests)) {
    if (Object.keys(q.done).length === 0) continue
    const town = `${q.cityName}|${q.center.lat.toFixed(1)},${q.center.lon.toFixed(1)}`
    const seen = byCity.get(town)
    if (!seen || seen.date < q.date) byCity.set(town, { id: q.cityId, name: q.cityName, center: q.center, date: q.date })
  }
  return [...byCity.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export const completedQuests = (p: Progress) =>
  Object.values(p.quests).filter((q) => Object.keys(q.done).length === q.steps).length

export const BADGES = ['firstTrain', 'castles', 'rain', 'earlyBird', 'questDone', 'tenTowns'] as const
export type Badge = (typeof BADGES)[number]

export function earnedBadges(p: Progress): Set<Badge> {
  const quests = Object.values(p.quests)
  const steps = quests.flatMap((q) => Object.values(q.done).map((d) => ({ q, d })))
  const earned = new Set<Badge>()
  if (steps.length > 0) earned.add('firstTrain')
  if (steps.some(({ d }) => d.category === 'historic' || d.category === 'architecture')) earned.add('castles')
  if (steps.some(({ q }) => q.rainy)) earned.add('rain')
  if (steps.some(({ q }) => q.early)) earned.add('earlyBird')
  if (completedQuests(p) > 0) earned.add('questDone')
  if (visitedTowns(p).length >= 10) earned.add('tenTowns')
  return earned
}

// ---- changes ----------------------------------------------------------------------------------------

export type QuestInfo = Omit<QuestRecord, 'done'>

/** Marks a step done, or undoes it. Pure: returns the new progress. */
export function toggleStep(
  p: Progress,
  info: QuestInfo,
  index: number,
  step: { xp: number; category?: PlaceCategory },
  now: Date = new Date(),
): Progress {
  const old = p.quests[info.key]
  const done = { ...(old?.done ?? {}) }
  if (done[index]) delete done[index]
  else done[index] = { xp: step.xp, at: now.toISOString(), ...(step.category ? { category: step.category } : {}) }
  // The facts of the trip day are fixed by the first tick: a newer forecast or opening the same quest with another
  // departure time must not take a badge away or give one.
  const started = old !== undefined && Object.keys(old.done).length > 0
  const facts = started ? { rainy: old.rainy, early: old.early } : { rainy: info.rainy, early: info.early }
  return {
    ...p,
    since: p.since ?? todayBerlin(now),
    quests: { ...p.quests, [info.key]: { ...info, ...facts, done } },
  }
}

// ---- storage ----------------------------------------------------------------------------------------

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isText = (x: unknown): x is string => typeof x === 'string'
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** One stored quest, or null when it is broken (edited by hand, cut off, an old format): it is dropped, not trusted. */
function cleanQuest(key: string, x: unknown): QuestRecord | null {
  if (!isObject(x) || !isText(x.cityId) || !isText(x.cityName) || !isText(x.date)) return null
  if (!Number.isInteger(x.steps) || (x.steps as number) < 0) return null
  const steps = x.steps as number
  if (!isObject(x.center) || !isNumber(x.center.lat) || !isNumber(x.center.lon) || !isObject(x.done)) return null
  const done: Record<number, DoneStep> = {}
  for (const [i, d] of Object.entries(x.done)) {
    const n = Number(i)
    // Only real step numbers: a tick on step 7 of a 3-step quest would count XP for nothing.
    if (!Number.isInteger(n) || n < 0 || n >= steps) continue
    if (!isObject(d) || !isNumber(d.xp) || d.xp < 0 || d.xp > 1000 || !isText(d.at)) continue
    done[n] = { xp: d.xp, at: d.at, ...(isText(d.category) ? { category: d.category as PlaceCategory } : {}) }
  }
  const isStep = (s: unknown): s is QuestStep =>
    isObject(s) && isText(s.time) && isText(s.title) && isText(s.description) && isNumber(s.xp) &&
    (s.placeId === undefined || isText(s.placeId))
  // A plan with a single broken step is not used: the ticks point into it by number.
  const plan =
    isObject(x.plan) && isText(x.plan.title) && Array.isArray(x.plan.steps) && x.plan.steps.length > 0 && x.plan.steps.every(isStep)
      ? { title: x.plan.title, byAi: x.plan.byAi === true, steps: x.plan.steps }
      : undefined
  return {
    key,
    cityId: x.cityId,
    cityName: x.cityName,
    center: { lat: x.center.lat, lon: x.center.lon },
    date: x.date,
    steps,
    done,
    rainy: x.rainy === true,
    early: x.early === true,
    ...(plan ? { plan } : {}),
  }
}

/** The stored progress made safe to use: the screens can trust every field. Exported for tests. */
export function cleanProgress(x: unknown): Progress {
  if (!isObject(x) || x.v !== 1 || !isObject(x.quests)) return EMPTY
  const quests: Record<string, QuestRecord> = {}
  for (const [key, q] of Object.entries(x.quests)) {
    const clean = cleanQuest(key, q)
    if (clean) quests[key] = clean
  }
  return {
    v: 1,
    since: isText(x.since) ? x.since : null,
    quests,
    ...(isNumber(x.best) ? { best: x.best } : {}),
  }
}

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? cleanProgress(JSON.parse(raw)) : EMPTY
  } catch {
    return EMPTY // private mode, blocked storage or a broken value: start fresh rather than crash
  }
}

/** False when the browser keeps nothing (private mode, storage blocked or full): the progress ends with the visit. */
let stored = true
export const progressIsStored = () => stored

/** Start over: the way out of a progress that breaks the app (the error screen offers it). */
export function resetProgress() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing stored anyway
  }
  current = EMPTY
  listeners.forEach((l) => l())
}

let current: Progress | null = null
const listeners = new Set<() => void>()

function snapshot(): Progress {
  current ??= read()
  return current
}

export function saveProgress(next: Progress) {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    stored = true
  } catch {
    // Storage full or blocked: the progress lives on for this visit - and the screens say so.
    stored = false
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      current = read()
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY)
}

/** For tests: forget the in-memory copy so the next read goes to localStorage. */
export function resetProgressCache() {
  current = null
}
