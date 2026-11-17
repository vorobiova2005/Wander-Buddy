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

/** Towns with at least one quest step done, latest first. */
export function visitedTowns(p: Progress) {
  const byCity = new Map<string, { id: string; name: string; center: Coordinates; date: string }>()
  for (const q of Object.values(p.quests)) {
    if (Object.keys(q.done).length === 0) continue
    const seen = byCity.get(q.cityId)
    if (!seen || seen.date < q.date) byCity.set(q.cityId, { id: q.cityId, name: q.cityName, center: q.center, date: q.date })
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
  return {
    ...p,
    since: p.since ?? todayBerlin(now),
    quests: { ...p.quests, [info.key]: { ...info, done } },
  }
}

// ---- storage ----------------------------------------------------------------------------------------

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const data = JSON.parse(raw) as Progress
    return data && data.v === 1 && typeof data.quests === 'object' ? data : EMPTY
  } catch {
    return EMPTY // private mode, blocked storage or a broken value: start fresh rather than crash
  }
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
  } catch {
    // Storage full or blocked: the progress lives on for this visit.
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
