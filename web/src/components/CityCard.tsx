import { useTranslation } from 'react-i18next'
import type { Destination, Enrichment } from '../api/types'
import { localTime } from '../lib/time'
import { tempRange, weatherKind } from '../lib/weather'
import { Chip, formatScore, useDuration } from './ui'

/** The "Картка міста" component: rank, name, trip, weather and places, the score. The whole card is one button. */
export function CityCard({
  city,
  rank,
  reason,
  enrichment,
  onOpen,
  onActive,
  compact = false,
}: {
  city: Destination
  rank: number
  reason?: string
  enrichment: Enrichment
  onOpen: () => void
  /** The card is pointed at or focused (true) or left (false) - the map highlights its pin. */
  onActive?: (active: boolean) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const duration = useDuration()
  const top = rank <= 3
  return (
    <li className="space-y-1.5">
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => onActive?.(true)}
        onMouseLeave={() => onActive?.(false)}
        onFocus={() => onActive?.(true)}
        onBlur={() => onActive?.(false)}
        className={`group flex w-full items-center gap-3 rounded-lg border-2 border-line bg-surface text-left transition
          hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_4px_0_var(--color-line)] ${compact ? 'p-3' : 'p-4'}`}
      >
        <span
          aria-hidden
          className={`grid shrink-0 place-items-center rounded-full font-display font-semibold
            ${top ? 'size-9 bg-sun text-[17px]' : 'size-8 border-2 border-ink bg-surface text-[14px]'}`}
        >
          {rank}
        </span>
        {/* The {' '} and the sr-only commas keep the parts apart when a screen reader reads the card as one name. */}
        <span className="sr-only">{t('results.rank', { rank })}</span>{' '}
        <span className="min-w-0 flex-1 space-y-1">
          <span className={`block font-display font-semibold break-words ${compact ? 'text-[15px] leading-5' : 'text-[17px] leading-[22px]'}`}>
            {city.name}
            <span className="sr-only">, </span>
          </span>{' '}
          <span className="block text-[13px] leading-[18px] text-ink-muted">
            {duration(city.minutes)} · {t('unit.transfers', { count: city.transfers })} ·{' '}
            {t('results.arrival', { time: localTime(city.arrival) })}
            <span className="sr-only">, </span>
          </span>{' '}
          {!compact && (
            <span className="flex flex-wrap gap-1.5 pt-0.5">
              <WeatherChip city={city} enrichment={enrichment} />{' '}
              {city.sightsTotal !== null && city.sightsTotal > 0 && (
                <Chip tone="primary">
                  <span aria-hidden>🏰</span>
                  {t('unit.places', { count: city.sightsTotal })}
                  <span className="sr-only">, </span>
                </Chip>
              )}
            </span>
          )}
        </span>{' '}
        <span className="shrink-0 text-right">
          <span className={`block font-display font-semibold text-primary tabular-nums ${compact ? 'text-[17px]' : 'text-[24px] leading-7'}`}>
            {formatScore(city.score.total)}
          </span>{' '}
          <span className="block text-[12px] leading-4 text-ink-muted">
            {t('unit.score')}
            <span className="sr-only">.</span>
          </span>
        </span>{' '}
        <span className="sr-only">{t('results.openQuest', { city: city.name })}</span>
        <span aria-hidden className="-mr-1 text-[22px] leading-none text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-primary">
          ›
        </span>
      </button>
      {reason && (
        <p className="flex gap-1.5 px-1 text-[13px] leading-[18px] text-ink-muted">
          <span aria-hidden>💬</span>
          {reason}
        </p>
      )}
    </li>
  )
}

export function WeatherChip({ city, enrichment }: { city: Destination; enrichment: Enrichment }) {
  const { t } = useTranslation()
  const w = city.weather
  if (!w) {
    return <Chip>{enrichment.weather === 'out_of_range' ? t('weather.outOfRange') : t('weather.unknown')}</Chip>
  }
  const kind = weatherKind(w.code)
  return (
    <Chip title={t(`weather.kind.${kind.key}`)}>
      <span aria-hidden>{kind.icon}</span>
      <span className="sr-only">{t(`weather.kind.${kind.key}`)},</span>{' '}
      {tempRange(w)}
      {w.precipitationProbability !== null && ` · ${t('unit.rain', { p: w.precipitationProbability })}`}
      <span className="sr-only">, </span>
    </Chip>
  )
}
