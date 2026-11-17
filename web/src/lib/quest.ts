import type { Destination, Place, PlaceCategory, Quest, QuestStep, Verdict } from '../api/types'
import { addMinutes, localTime } from './time'

/** Words the generated quest is made of - from i18n, so this module stays free of UI strings. */
export type QuestWords = {
  title: (city: string) => string
  arrival: { title: string; description: (station: string) => string }
  place: (category: PlaceCategory) => string
  food: { title: string; description: string }
  back: { title: string; description: (origin: string) => string }
}

/**
 * The quest for a town: the AI's plan when the verdict made one for this town; otherwise a plan built from the
 * town's places - the user always gets a quest, with or without the AI.
 */
export function questFor(city: Destination, verdict: Verdict | null, origin: string, words: QuestWords): Quest & { byAi: boolean } {
  if (verdict && verdict.quest.cityId === city.id) return { ...verdict.quest, byAi: true }
  return { ...generatedQuest(city, origin, words), byAi: false }
}

export function generatedQuest(city: Destination, origin: string, w: QuestWords): Quest {
  const sights = city.places.filter((p) => p.category !== 'food').slice(0, 3)
  const cafe = city.places.find((p) => p.category === 'food')
  const start = localTime(city.arrival) || '10:00'
  const steps: QuestStep[] = [{ time: start, title: w.arrival.title, description: w.arrival.description(city.station.name), xp: 10 }]
  let time = addMinutes(start, 15)
  sights.forEach((p, i) => {
    steps.push({ time, title: p.name, placeId: p.id, description: w.place(p.category), xp: 10 + 5 * Math.max(1, p.rating) })
    time = addMinutes(time, 75)
    if (i === 1) {
      steps.push({ time, title: cafe?.name ?? w.food.title, ...(cafe ? { placeId: cafe.id } : {}), description: w.food.description, xp: 10 })
      time = addMinutes(time, 60)
    }
  })
  if (sights.length < 2) {
    steps.push({ time, title: cafe?.name ?? w.food.title, ...(cafe ? { placeId: cafe.id } : {}), description: w.food.description, xp: 10 })
    time = addMinutes(time, 60)
  }
  steps.push({ time, title: w.back.title, description: w.back.description(origin), xp: 10 })
  return { cityId: city.id, title: w.title(city.name), steps }
}

const FOOD_WORDS = /обід|кав|перекус|ланч|кафе|пекарн|смакол|їж/i

/** A lunch or coffee step - Вандер gets hungry before it. */
export function isFoodStep(step: QuestStep, places: Place[]): boolean {
  const place = step.placeId ? places.find((p) => p.id === step.placeId) : undefined
  return place?.category === 'food' || FOOD_WORDS.test(step.title)
}

/** One quest per town and day. */
export const questKey = (date: string, cityId: string) => `${date}|${cityId}`
