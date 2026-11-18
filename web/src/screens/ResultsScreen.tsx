import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Search } from '../api/client'
import type { Destination, Destinations, VerdictAnswer } from '../api/types'
import { CityCard } from '../components/CityCard'
import { TripMap } from '../components/LazyTripMap'
import type { MapPoint } from '../components/TripMap'
import { CardSkeleton, WaitingWander } from '../components/Waiting'
import { WanderSays } from '../components/Wander'
import { BackLink, Button, Card, ScreenTitle, useDuration } from '../components/ui'
import { chooseMood, pickLine } from '../lib/mood'
import { navigate } from '../lib/router'
import { shortDay } from '../lib/time'
import type { Loadable } from '../lib/trip'

/** Server error codes with their own message (results.error.*); anything else is "something went wrong". */
const KNOWN_ERRORS = ['origin_not_found', 'origin_outside', 'date_out_of_range', 'busy', 'upstream_unavailable', 'network']

type Props = {
  search: Search
  destinations: Loadable<Destinations>
  verdict: Loadable<VerdictAnswer>
  retry: () => void
  retryVerdict: () => void
}

/**
 * The results map: a strip on phones; on a desktop the screen height minus the top bar (72), the gap above (40),
 * the legend and a margin below - so the whole map with its legend is always in view, from 720 px high screens up.
 */
const MAP_HEIGHT = 'h-[240px] sm:h-[320px] lg:h-[calc(100dvh-176px)] lg:min-h-[400px] lg:max-h-[760px]'

/** Screen 2 - where to go: the map, Вандер's verdict, the top 3, warnings and the other towns. */
export function ResultsScreen({ search, destinations, verdict, retry, retryVerdict }: Props) {
  const { t } = useTranslation()
  const duration = useDuration()
  const openQuest = (cityId: string) => navigate({ name: 'quest', search, cityId })

  const origin =
    destinations.status === 'ok'
      ? originName(destinations.data, t('results.myPlace'))
      : search.from || t('results.myPlace')
  const meta = [
    t('results.meta', { origin, day: shortDay(search.date), time: search.time, limit: t('unit.upTo', { value: duration(search.maxMinutes) }) }),
    destinations.status === 'ok' ? t('unit.towns', { count: destinations.data.cities.length }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const header = (
    <div className="space-y-2">
      <BackLink onClick={() => navigate({ name: 'search' })}>{t('results.back')}</BackLink>
      <ScreenTitle sub={meta}>{t('results.title')}</ScreenTitle>
    </div>
  )

  if (destinations.status === 'loading') {
    return (
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-12 xl:grid-cols-[minmax(0,640px)_1fr]">
        <div className={`rounded-lg border-2 border-line bg-primary-soft motion-safe:animate-pulse max-lg:order-2 ${MAP_HEIGHT}`} />
        <div className="contents lg:block lg:space-y-6">
          <div className="max-lg:order-1">{header}</div>
          <div className="space-y-6 max-lg:order-3">
            <WaitingWander />
            <CardSkeleton />
          </div>
        </div>
      </div>
    )
  }

  if (destinations.status === 'error' || destinations.data.cities.length === 0) {
    const message =
      destinations.status === 'error'
        ? t(`results.error.${KNOWN_ERRORS.includes(destinations.error.code) ? destinations.error.code : 'other'}`)
        : t('results.empty')
    const lines = t('wander.lines.lost', { returnObjects: true }) as string[]
    return (
      <div className="space-y-6">
        {header}
        <div className="max-w-xl space-y-5">
          <WanderSays mood="lost" line={pickLine(lines, search.date + search.time)} size={140} />
          <p role="alert" className="font-semibold">
            {message}
          </p>
          <div className="flex flex-wrap gap-3">
            {destinations.status === 'error' && <Button onClick={retry}>{t('results.retry')}</Button>}
            <Button variant="secondary" onClick={() => navigate({ name: 'search' })}>
              {t('results.back')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return <Loaded search={search} data={destinations.data} verdict={verdict} header={header} onOpen={openQuest} retryVerdict={retryVerdict} />
}

function Loaded({
  search,
  data,
  verdict,
  header,
  onOpen,
  retryVerdict,
}: {
  search: Search
  data: Destinations
  verdict: Loadable<VerdictAnswer>
  header: React.ReactNode
  onOpen: (cityId: string) => void
  retryVerdict: () => void
}) {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const pointAt = (id: string) => (on: boolean) => setActive((cur) => (on ? id : cur === id ? null : cur))
  const byId = useMemo(() => new Map(data.cities.map((c) => [c.id, c])), [data])

  const v = verdict.status === 'ok' ? verdict.data.verdict : null
  const waiting = verdict.status === 'loading'
  const aiDown = verdict.status === 'error' || (verdict.status === 'ok' && !v)
  // The AI's top 3 when there is a verdict, otherwise the formula's. While the AI thinks, no cards yet: they would
  // reorder under the user's finger when it answers.
  const top: { city: Destination; reason?: string }[] = v
    ? v.top.flatMap((x) => (byId.has(x.id) ? [{ city: byId.get(x.id)!, reason: x.reason }] : []))
    : data.cities.slice(0, 3).map((city) => ({ city }))
  const topIds = new Set(top.map((x) => x.city.id))
  const rest = data.cities.filter((c) => !topIds.has(c.id))

  const first = top[0]?.city
  const mood = chooseMood({ waiting, weather: first?.weather, departure: search.time, ai: v?.character.mood ?? (waiting ? null : 'thoughtful') })
  const funny = t(`wander.lines.${mood}`, { returnObjects: true }) as string[]
  // The AI's own line only with its own mood: "let's go!" under an inside-out umbrella would not fit.
  const line = waiting
    ? t('results.aiThinking')
    : v && mood === v.character.mood
      ? v.character.line
      : pickLine(funny, search.date + (first?.id ?? ''))

  const points: MapPoint[] = useMemo(
    () =>
      waiting
        ? [
            { id: 'origin', lat: data.origin.lat, lon: data.origin.lon, label: originName(data, t('results.myPlace')), kind: 'origin' },
            ...data.cities.slice(0, 5).map((city, i) => pin(city, 'candidate', i + 1, onOpen)),
          ]
        : [
            { id: 'origin', lat: data.origin.lat, lon: data.origin.lon, label: originName(data, t('results.myPlace')), kind: 'origin' },
            ...top.map(({ city }, i) => pin(city, 'top', i + 1, onOpen)),
            ...rest.slice(0, 2).map((city, i) => pin(city, 'candidate', top.length + i + 1, onOpen)),
            // The other towns only when their list is open - otherwise 30 dots say nothing.
            ...(showAll ? rest.slice(2).map((city) => pin(city, 'dot', undefined, onOpen)) : []),
          ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, waiting, v, showAll, t],
  )
  const warnings = v ? v.warnings.map((w) => w.text) : [t('results.checkTrainBack')]
  const gaps = data.enrichment.weather === 'unavailable' || data.enrichment.placesFailures > 0 || data.enrichment.placesPaused

  return (
    // Phone: title, map, the rest - one column. Desktop: the map fills the left column from the top and stays in view
    // (it always fits the screen height), the title and the decision scroll on the right.
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-12 xl:grid-cols-[minmax(0,640px)_1fr]">
      <div className="max-lg:order-2 lg:sticky lg:top-[112px]">
        <TripMap points={points} activeId={active} label={t('results.map')} className={MAP_HEIGHT} />
        <MapLegend withOthers={showAll} />
      </div>

      <div className="contents lg:block lg:space-y-6">
        <div className="max-lg:order-1">{header}</div>
        <div className="space-y-6 max-lg:order-3">
          <WanderSays mood={mood} line={line} />

          <section aria-labelledby="top3" className="space-y-3">
            <h2 id="top3" className="text-[17px] leading-[22px] font-medium">
              {aiDown ? t('results.top3Formula') : t('results.top3')}
            </h2>
            {aiDown && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-alt px-3 py-2">
                <p className="text-[13px] leading-[18px] text-ink-muted">{verdict.status === 'error' ? t('results.aiFailed') : t('results.aiOff')}</p>
                <button type="button" onClick={retryVerdict} className="min-h-11 rounded-full px-3 text-[13px] font-bold text-primary-strong hover:bg-primary-soft">
                  {t('results.aiRetry')}
                </button>
              </div>
            )}
            {waiting ? (
              <CardSkeleton />
            ) : (
              <ol className="space-y-4">
                {top.map(({ city, reason }, i) => (
                  <CityCard key={city.id} city={city} rank={i + 1} reason={reason} enrichment={data.enrichment} onOpen={() => onOpen(city.id)} onActive={pointAt(city.id)} />
                ))}
              </ol>
            )}
          </section>

          {v && (
            <Card as="section" className="space-y-1.5 p-4">
              <h2 className="text-[15px] font-bold font-sans">{t('results.comparison')}</h2>
              <p className="text-ink-muted">{v.comparison}</p>
            </Card>
          )}

          {!waiting && (
            <section aria-labelledby="warn" className="space-y-2 rounded-md border-l-4 border-accent bg-surface-alt p-4">
              <h2 id="warn" className="font-sans text-[15px] font-bold">
                <span aria-hidden>⚠️ </span>
                {t('results.warnings')}
              </h2>
              <ul className="space-y-1.5 text-[14px] leading-5">
                {warnings.map((w, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden>•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {gaps && <p className="text-[13px] leading-[18px] text-ink-muted">{t('results.dataGaps')}</p>}

          {!waiting && rest.length > 0 && (
            <section aria-label={t('results.others')} className="space-y-3">
              {showAll && (
                <ol start={top.length + 1} className="space-y-2">
                  {rest.map((city, i) => (
                    <CityCard key={city.id} city={city} rank={top.length + i + 1} enrichment={data.enrichment} onOpen={() => onOpen(city.id)} onActive={pointAt(city.id)} compact />
                  ))}
                </ol>
              )}
              <Button variant="secondary" className="w-full" aria-expanded={showAll} onClick={() => setShowAll((s) => !s)}>
                {showAll ? t('results.less') : t('results.more', { count: rest.length })}
              </Button>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function pin(city: Destination, kind: MapPoint['kind'], number: number | undefined, onOpen: (id: string) => void): MapPoint {
  return { id: city.id, lat: city.center.lat, lon: city.center.lon, label: city.name, kind, number, onSelect: () => onOpen(city.id) }
}

/** What the pins mean - and that they can be tapped. */
function MapLegend({ withOthers }: { withOthers: boolean }) {
  const { t } = useTranslation()
  const item = (cls: string, size: number, text: string, mark = '') => (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`wb-pin ${cls}`} style={{ width: size, height: size, fontSize: 9 }}>
        {mark}
      </span>
      {text}
    </li>
  )
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-[12px] leading-4 text-ink-muted">
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={t('results.legend.title')}>
        {item('wb-pin--origin', 12, t('results.legend.origin'))}
        {item('wb-pin--top', 16, t('results.legend.top'), '1')}
        {item('', 16, t('results.legend.candidate'), '4')}
        {withOthers && item('wb-pin--dot', 10, t('results.legend.other'))}
      </ul>
      <span>{t('results.legend.hint')}</span>
    </div>
  )
}

export function originName(d: Destinations, myPlace: string): string {
  return namedOrigin(d) || myPlace
}

/** The start's town or station; empty when it is a point on the map with no known town. */
export function namedOrigin(d: Destinations): string {
  return d.origin.locality ?? d.origin.name
}
