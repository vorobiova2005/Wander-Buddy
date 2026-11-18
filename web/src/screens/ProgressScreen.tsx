import { useTranslation } from 'react-i18next'
import { TripMap } from '../components/LazyTripMap'
import { Wander } from '../components/Wander'
import { Button, Card, ScreenTitle, formatInt } from '../components/ui'
import { navigate } from '../lib/router'
import { BADGES, completedQuests, earnedBadges, levelOf, progressIsStored, totalXp, useProgress, visitedTowns, type Badge } from '../lib/progress'

const BADGE_ICON: Record<Badge, string> = {
  firstTrain: '🚆',
  castles: '🏰',
  rain: '🌧️',
  earlyBird: '🌅',
  questDone: '🏁',
  tenTowns: '🗺️',
}

/** Screen 4 - the player: level, experience, visited towns on the map, badges. */
export function ProgressScreen() {
  const { t } = useTranslation()
  const progress = useProgress()
  const xp = totalXp(progress)
  const lvl = levelOf(xp)
  const towns = visitedTowns(progress)
  const quests = completedQuests(progress)
  const badges = earnedBadges(progress)
  const since = progress.since
    ? new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${progress.since}T12:00:00Z`))
    : null

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[420px_1fr] lg:items-start lg:gap-12">
      <div className="space-y-4">
        <ScreenTitle>{t('progress.title')}</ScreenTitle>
        {!progressIsStored() && (
          <p role="status" className="rounded-md border-2 border-accent bg-surface p-3 text-[13px] leading-[18px] font-semibold">
            {t('progress.notStored')}
          </p>
        )}
        <Card as="section" className="space-y-4 p-5 text-center">
          <Wander mood={xp > 0 ? 'happy' : 'waiting'} size={170} className="mx-auto" />
          <div>
            <h2 className="text-[17px] leading-[22px] font-medium">{t('progress.together')}</h2>
            <p className="text-[13px] leading-[18px] text-ink-muted">{since ? t('progress.since', { date: since }) : t('progress.newcomer')}</p>
          </div>
          <div className="space-y-2 text-left">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-bold">{t('progress.levelLine', { level: lvl.level, title: t(`progress.levels.${lvl.title}`) })}</span>
              <span className="text-[13px] text-ink-muted tabular-nums">{t('progress.xpOf', { into: formatInt(lvl.into), need: formatInt(lvl.need) })}</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={lvl.need}
              aria-valuenow={lvl.into}
              aria-label={t('progress.levelLine', { level: lvl.level, title: t(`progress.levels.${lvl.title}`) })}
              className="h-3 overflow-hidden rounded-full bg-surface-alt"
            >
              <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(lvl.into / lvl.need) * 100}%` }} />
            </div>
          </div>
        </Card>
        <dl className="grid grid-cols-3 gap-2.5">
          {[
            [towns.length, t('progress.towns', { count: towns.length })],
            [quests, t('progress.quests', { count: quests })],
            [xp, t('progress.xp')],
          ].map(([n, label]) => (
            <Card key={String(label)} className="flex flex-col-reverse items-center p-3 text-center">
              <dt className="text-[13px] leading-[18px] text-ink-muted">{label}</dt>
              <dd className="font-display text-[24px] leading-8 font-semibold text-primary tabular-nums">{formatInt(Number(n))}</dd>
            </Card>
          ))}
        </dl>
      </div>

      <div className="space-y-6 lg:pt-[50px]">
        <section aria-labelledby="visited" className="space-y-3">
          <h2 id="visited" className="text-[17px] leading-[22px] font-medium">
            {t('progress.visited')}
          </h2>
          {towns.length > 0 ? (
            <TripMap
              label={t('progress.visitedMap')}
              maxZoom={10}
              className="h-[220px] lg:h-[420px]"
              points={towns.map((c) => ({ id: c.id, lat: c.center.lat, lon: c.center.lon, label: `✓ ${c.name}`, kind: 'top' }))}
            />
          ) : (
            <div className="space-y-3 rounded-lg border-2 border-dashed border-line p-5 text-center">
              <p className="text-ink-muted">{t('progress.visitedEmpty')}</p>
              <Button onClick={() => navigate({ name: 'search' })}>{t('progress.findFirst')}</Button>
            </div>
          )}
        </section>

        <section aria-labelledby="badges" className="space-y-3">
          <h2 id="badges" className="text-[17px] leading-[22px] font-medium">
            {t('progress.badges')}
          </h2>
          <ul className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-6">
            {BADGES.map((b) => {
              const has = badges.has(b)
              return (
                <li key={b} className="flex flex-col items-center gap-1.5 text-center">
                  <span
                    aria-hidden
                    className={`grid size-14 place-items-center rounded-full border-2 text-[24px]
                      ${has ? 'border-ink bg-sun' : 'border-line bg-surface-alt opacity-50 grayscale'}`}
                  >
                    {BADGE_ICON[b]}
                  </span>
                  <span className={`text-[13px] leading-[18px] font-medium ${has ? '' : 'text-ink-muted'}`}>
                    {t(`progress.badge.${b}.name`)}
                    <span className="sr-only"> - {has ? t('progress.earned') : t('progress.locked')}.</span>
                  </span>
                  {/* How to get it - visible on phones too, where there is no hover. */}
                  {!has && <span className="text-[11px] leading-[14px] text-ink-muted">{t(`progress.badge.${b}.hint`)}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
