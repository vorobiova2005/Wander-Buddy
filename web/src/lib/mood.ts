import type { AiMood, Weather } from '../api/types'
import type { WanderMood } from '../components/wanderArt'
import { isCold, isRainy } from './weather'

/** Departures before this time make Вандер sleepy. */
export const EARLY_BEFORE = '07:00'

export type MoodFacts = {
  celebrating?: boolean
  /** Nothing found, or an error. */
  lost?: boolean
  /** Waiting for the data or the AI. */
  waiting?: boolean
  /** The next quest step is lunch or coffee. */
  hungry?: boolean
  weather?: Weather | null
  /** HH:MM of the departure. */
  departure?: string
  /** What the AI chose (character.mood). */
  ai?: AiMood | null
}

/**
 * The situational mood the app picks from the data (docs/ui.md). The order is what matters most to the user right
 * now: a new level, a problem, a wait - then the day's facts - then the AI's own mood.
 */
export function chooseMood(f: MoodFacts): WanderMood {
  if (f.celebrating) return 'celebrating'
  if (f.lost) return 'lost'
  if (f.waiting) return 'waiting'
  if (f.hungry) return 'hungry'
  if (f.weather && isCold(f.weather)) return 'cold'
  if (f.weather && isRainy(f.weather)) return 'rainy'
  if (f.departure && f.departure < EARLY_BEFORE) return 'sleepy'
  return f.ai ?? 'happy'
}

/** A line for the mood: the same seed gives the same line, so it does not flicker on every render. */
export function pickLine(lines: string[], seed: string): string {
  if (lines.length === 0) return ''
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return lines[h % lines.length]
}
