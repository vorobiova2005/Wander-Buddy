import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Search } from '../api/client'
import type { Destination, Destinations, PlaceCategory, Quest, QuestStep, VerdictAnswer } from '../api/types'
import { WeatherChip } from '../components/CityCard'
import { TripMap } from '../components/LazyTripMap'
import type { MapPoint } from '../components/TripMap'
import { CardSkeleton, WaitingWander } from '../components/Waiting'
import { WanderSays } from '../components/Wander'
import { BackLink, Button, Chip, LinkButton, formatScore, useDuration } from '../components/ui'
import { bahnSearchUrl } from '../lib/bahn'
import { chooseMood, EARLY_BEFORE, pickLine } from '../lib/mood'
import { levelOf, saveProgress, toggleStep, totalXp, useProgress, type QuestInfo } from '../lib/progress'
import { isFoodStep, questFor, questKey, type QuestWords } from '../lib/quest'
import { navigate } from '../lib/router'
import { localTime } from '../lib/time'
import type { Loadable } from '../lib/trip'
import { isRainy } from '../lib/weather'
import { namedOrigin } from './ResultsScreen'

type Props = {
  search: Search
  cityId: string
  destinations: Loadable<Destinations>
  verdict: Loadable<VerdictAnswer>
  onLevelUp: (level: number) => void
}

/** Screen 3 - the day in one town as a quest: steps with XP, done steps saved in this browser. */
export function QuestScreen({ search, cityId, destinations, verdict, onLevelUp }: Props) {
  const { t } = useTranslation()
  const back = () => navigate({ name: 'results', search })

  if (destinations.status === 'loading') {
    return (
      <div className="max-w-xl space-y-6">
        <BackLink onClick={back}>{t('quest.back')}</BackLink>
        <WaitingWander />
        <CardSkeleton count={4} />
      </div>
    )
  }
  const city = destinations.status === 'ok' ? destinations.data.cities.find((c) => c.id === cityId) : undefined
  if (destinations.status === 'error' || !city) {
    return (
      <div className="max-w-xl space-y-5">
        <BackLink onClick={back}>{t('quest.back')}</BackLink>
        <WanderSays mood="lost" line={t('quest.notFound')} size={140} />
        <Button onClick={back}>{t('quest.toResults')}</Button>
      </div>
    )
  }
  return <CityQuest search={search} city={city} data={destinations.data} verdict={verdict} onLevelUp={onLevelUp} />
}

function CityQuest({
  search,
  city,
  data,
  verdict,
  onLevelUp,
}: {
  search: Search
  city: Destination
  data: Destinations
  verdict: Loadable<VerdictAnswer>
  onLevelUp: (level: number) => void
}) {
  const { t } = useTranslation()
  const duration = useDuration()
  const progress = useProgress()
  const [gain, setGain] = useState<{ xp: number; n: number } | null>(null)
  const gainTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(gainTimer.current), [])
  // The start by name; empty for "my place" without a known town - then nothing says "a train to my place".
  const home = namedOrigin(data)

  const words: QuestWords = useMemo(
    () => ({
      title: (name) => t('quest.generated.title', { city: name }),
      arrival: { title: t('quest.generated.arrival'), description: (station) => t('quest.generated.arrivalText', { station }) },
      place: (category: PlaceCategory) => t(`quest.generated.place.${category}`),
      food: { title: t('quest.generated.food'), description: t('quest.generated.foodText') },
      back: {
        title: t('quest.generated.back'),
        description: (o) => (o ? t('quest.generated.backText', { origin: o }) : t('quest.generated.backTextHome')),
      },
    }),
    [t],
  )

  const v = verdict.status === 'ok' ? verdict.data.verdict : null
  const key = questKey(search.date, city.id)
  const record = progress.quests[key]
  const started = record !== undefined && Object.keys(record.done).length > 0
  // A quest once started keeps its own plan: a new AI answer later must not move the ticks to other steps.
  const quest: (Quest & { byAi: boolean }) | null = started && record.plan
    ? { cityId: city.id, ...record.plan }
    : verdict.status === 'loading'
      ? null // until the AI has answered we do not know whose quest this town gets
      : questFor(city, v, home, words)
  const done = (i: number) => Boolean(record?.done[i])

  const info: QuestInfo | null = quest && {
    key,
    cityId: city.id,
    cityName: city.name,
    center: city.center,
    date: search.date,
    steps: quest.steps.length,
    rainy: isRainy(city.weather),
    early: search.time < EARLY_BEFORE,
    plan: { title: quest.title, byAi: quest.byAi, steps: quest.steps },
  }

  const toggle = (i: number) => {
    if (!quest || !info) return
    const step = quest.steps[i]
    const category = city.places.find((p) => p.id === step.placeId)?.category
    const next = toggleStep(progress, info, i, { xp: step.xp, category })
    if (!done(i)) {
      // A short "+20 XP" by the counter: the reward is seen, not only counted.
      setGain((g) => ({ xp: step.xp, n: (g?.n ?? 0) + 1 }))
      clearTimeout(gainTimer.current)
      gainTimer.current = setTimeout(() => setGain(null), 1600)
    }
    // Celebrate a level only the first time it is reached - not again after an undo and redo.
    const best = Math.max(progress.best ?? 1, levelOf(totalXp(progress)).level)
    const after = levelOf(totalXp(next)).level
    saveProgress({ ...next, best: Math.max(best, after) })
    if (after > best) onLevelUp(after)
  }

  const nextIndex = quest ? quest.steps.findIndex((_, i) => !done(i)) : -1
  const allDone = quest !== null && nextIndex === -1
  const doneCount = quest ? quest.steps.filter((_, i) => done(i)).length : 0
  const earned = quest ? quest.steps.reduce((sum, s, i) => sum + (done(i) ? s.xp : 0), 0) : 0

  const mood = allDone
    ? 'celebrating'
    : chooseMood({
        waiting: !quest,
        hungry: quest !== null && nextIndex >= 0 && isFoodStep(quest.steps[nextIndex], city.places),
        weather: city.weather,
        departure: search.time,
        ai: quest?.byAi ? v?.character.mood : null,
      })
  const line =
    quest?.byAi && v && mood === v.character.mood
      ? v.character.line
      : pickLine(t(`wander.lines.${mood}`, { returnObjects: true }) as string[], key + doneCount)

  const lastTime = quest?.steps.at(-1)?.time ?? '17:00'
  // TripMap rebuilds its icons only when the pins really change, so a fresh array here costs nothing.
  const points = quest ? questPoints(city, quest, done) : []

  return (
    // Phone: one column - the town, Вандер, the steps, the buttons, the map. Desktop: the town, Вандер and the buttons
    // stay in view on the left; the steps and their map scroll on the right.
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[400px_1fr] lg:items-start lg:gap-12 xl:grid-cols-[440px_1fr]">
      <div className="contents lg:sticky lg:top-[112px] lg:block lg:space-y-6">
        <header className="space-y-3 max-lg:order-1">
          <BackLink onClick={() => navigate({ name: 'results', search })}>{t('quest.back')}</BackLink>
          <div className="flex items-start justify-between gap-3">
            <h1 className="min-w-0 text-[28px] leading-[34px] font-bold break-words">{city.name}</h1>
            <Chip tone="primary" className="mt-1">
              {formatScore(city.score.total)} {t('unit.score')}
            </Chip>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip>
              <span aria-hidden>🚆</span>
              {duration(city.minutes)} · {t('unit.transfers', { count: city.transfers })}
            </Chip>
            <Chip>
              <span aria-hidden>🕘</span>
              {t('results.arrival', { time: localTime(city.arrival) })}
            </Chip>
            <WeatherChip city={city} enrichment={data.enrichment} />
            {city.weather && city.weather.sunshineHours > 0 && (
              <Chip>
                <span aria-hidden>🌞</span>
                {t('unit.sunshine', { h: Math.round(city.weather.sunshineHours) })}
              </Chip>
            )}
            {city.sightsTotal !== null && city.sightsTotal > 0 && (
              <Chip>
                <span aria-hidden>🏰</span>
                {t('unit.places', { count: city.sightsTotal })}
              </Chip>
            )}
          </div>
        </header>
        <div className="max-lg:order-2">{quest ? <WanderSays mood={mood} line={line} /> : <WaitingWander />}</div>
        <div className="space-y-3 max-lg:order-4">
          {allDone ? (
            <p role="status" className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-success/15 px-6 font-bold text-ink">
              {t('quest.allDone')}
            </p>
          ) : (
            <Button className="w-full" disabled={!quest} onClick={() => nextIndex >= 0 && toggle(nextIndex)}>
              {t('quest.markNext')}
            </Button>
          )}
          <LinkButton className="w-full" href={bahnSearchUrl(city.station.name, home, search.date, lastTime)}>
            {t('quest.bahn')}
            <span aria-hidden>↗</span>
          </LinkButton>
        </div>
      </div>
      <div className="contents lg:block lg:space-y-6">
        <section aria-labelledby="quest-title" className="space-y-3 max-lg:order-3">
          {quest ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 id="quest-title" className="min-w-0 text-[17px] leading-[22px] font-medium">
                  {t('quest.title', { title: quest.title })}
                </h2>
                <span className="relative shrink-0">
                  <Chip tone="accent" className="font-bold">
                    {t('quest.count', { done: doneCount, total: quest.steps.length, xp: earned })}
                  </Chip>
                  <span role="status" className="pointer-events-none absolute -top-7 right-0">
                    {gain && (
                      <span
                        key={gain.n}
                        className="block rounded-full bg-accent px-2 text-[13px] leading-5 font-extrabold text-ink motion-safe:animate-[rise_1.6s_ease-out_forwards]"
                      >
                        +{gain.xp} XP
                      </span>
                    )}
                  </span>
                </span>
              </div>
              {!allDone && <p className="text-[13px] leading-[18px] text-ink-muted">{t('quest.hint')}</p>}
              <ol className="space-y-2.5">
                {quest.steps.map((step, i) => (
                  <StepRow key={`${i}-${step.time}`} step={step} done={done(i)} onToggle={() => toggle(i)} />
                ))}
              </ol>
              <p className="text-[13px] leading-[18px] text-ink-muted">
                {quest.byAi ? t('quest.byAi') : verdict.status === 'ok' && v ? t('quest.byWander') : t('quest.byWanderNoAi')}
              </p>
            </>
          ) : (
            <>
              <h2 id="quest-title" className="sr-only">
                {t('quest.title', { title: city.name })}
              </h2>
              <CardSkeleton count={4} />
            </>
          )}
        </section>
        {quest && (
          <div className="max-lg:order-5">
            <TripMap points={points} label={t('quest.map')} className="h-[220px] lg:h-[340px]" />
          </div>
        )}
      </div>
    </div>
  )
}

/** One step: the whole row is a toggle; its state is told by aria-pressed, its text is read as it is. */
function StepRow({ step, done, onToggle }: { step: QuestStep; done: boolean; onToggle: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={done}
        className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors sm:p-4
          ${done ? 'border-primary/25 bg-primary-soft' : 'border-line bg-surface hover:border-primary/50'}`}
      >
        <span className="w-11 shrink-0 text-[12px] leading-4 font-extrabold tracking-wide tabular-nums">{step.time}</span>{' '}
        <span
          aria-hidden
          className={`grid size-6 shrink-0 place-items-center rounded-full border-2
            ${done ? 'border-success bg-success text-on-primary motion-safe:animate-pop' : 'border-ink'}`}
        >
          {done && (
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3.5 8.5 3 3 6-7" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold break-words">
            {step.title}
            <span className="sr-only">.</span>
          </span>{' '}
          <span className="block text-[13px] leading-[18px] text-ink-muted">{step.description}</span>
        </span>{' '}
        <Chip tone="accent" className="shrink-0 font-bold">
          +{step.xp} XP
        </Chip>
      </button>
    </li>
  )
}

/** The station and the quest's places, numbered by step. */
function questPoints(city: Destination, quest: Quest, done: (i: number) => boolean): MapPoint[] {
  const points: MapPoint[] = [{ id: 'station', lat: city.station.lat, lon: city.station.lon, label: city.station.name, kind: 'origin' }]
  quest.steps.forEach((step, i) => {
    const place = step.placeId ? city.places.find((p) => p.id === step.placeId) : undefined
    if (place) points.push({ id: `${i}-${place.id}`, lat: place.lat, lon: place.lon, label: place.name, kind: done(i) ? 'done' : 'step', number: i + 1 })
  })
  return points
}
