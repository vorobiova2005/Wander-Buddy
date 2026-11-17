import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Search } from './api/client'
import { BottomNav, TopNav, type Tab } from './components/Nav'
import { Wander } from './components/Wander'
import { Button } from './components/ui'
import { levelOf, levelStart, totalXp, useProgress } from './lib/progress'
import { lastResults, navigate, useRoute, type Route } from './lib/router'
import { useTrip } from './lib/trip'
import { pickLine } from './lib/mood'
import { ProgressScreen } from './screens/ProgressScreen'
import { QuestScreen } from './screens/QuestScreen'
import { ResultsScreen } from './screens/ResultsScreen'
import { SearchScreen } from './screens/SearchScreen'

/**
 * The shell: navigation (a bottom bar on phones, a top bar from 1024 px), the screen of the current URL, the
 * footer with the data credits, and the level-up moment.
 */
export default function App() {
  const { t } = useTranslation()
  const route = useRoute()
  const progress = useProgress()
  const xp = totalXp(progress)
  const { level } = levelOf(xp)
  const [levelUp, setLevelUp] = useState<number | null>(null)

  const tab: Tab = route.name === 'progress' ? 'progress' : route.name === 'search' ? 'search' : 'map'
  const select = (to: Tab) => {
    if (to === 'search') navigate({ name: 'search' })
    else if (to === 'progress') navigate({ name: 'progress' })
    else navigate(route.name === 'results' || route.name === 'quest' ? { name: 'results', search: route.search } : (lastResults() ?? { name: 'search' }))
  }

  // A new screen: say so to screen readers by moving the focus to the content.
  const main = useRef<HTMLElement>(null)
  const screenKey = route.name === 'quest' ? `quest-${route.cityId}` : route.name
  useEffect(() => {
    main.current?.focus({ preventScroll: true })
  }, [screenKey])

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-[2000] rounded bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t('app.skip')}
      </a>
      <TopNav active={tab} onSelect={select} level={level} xp={xp} />

      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className="mx-auto w-full max-w-[640px] flex-1 px-4 pt-5 pb-8 outline-none sm:px-6 lg:max-w-[1248px] lg:px-12 lg:pt-10 lg:pb-16"
      >
        {route.name === 'search' && (
          <div className="mb-5 flex items-center justify-between lg:hidden">
            <span className="font-display text-[24px] leading-8 font-bold text-primary">{t('app.title')}</span>
            <button type="button" onClick={() => navigate({ name: 'progress' })} className="relative rounded-full bg-primary-soft px-3 py-1.5 text-[13px] font-bold text-primary-strong after:absolute after:-inset-2 after:content-['']">
              {t('nav.level', { level })}
            </button>
          </div>
        )}
        <Screen route={route} onLevelUp={setLevelUp} />
      </main>

      <Footer />
      <BottomNav active={tab} onSelect={select} />
      {levelUp !== null && <LevelUp level={levelUp} onClose={() => setLevelUp(null)} />}
    </div>
  )
}

function Screen({ route, onLevelUp }: { route: Route; onLevelUp: (level: number) => void }) {
  switch (route.name) {
    case 'search':
      return <SearchScreen />
    case 'progress':
      return <ProgressScreen />
    case 'results':
    case 'quest':
      return <TripScreens route={route} onLevelUp={onLevelUp} />
  }
}

/** Results and quests share the data of one search. */
function TripScreens({ route, onLevelUp }: { route: Extract<Route, { search: Search }>; onLevelUp: (level: number) => void }) {
  const { t } = useTranslation()
  const trip = useTrip(route.search)
  const d = trip.destinations
  const towns = d.status === 'ok' ? t('unit.towns', { count: d.data.cities.length }) : ''
  // One quiet status line for screen readers - Вандер's jokes change every few seconds and are not announced.
  const status =
    d.status === 'loading'
      ? t('quest.status.towns')
      : d.status === 'error'
        ? t('quest.status.failed')
        : trip.verdict.status === 'loading'
          ? t('quest.status.verdict', { towns })
          : trip.verdict.status === 'ok' && trip.verdict.data.verdict
            ? t('quest.status.ready', { towns })
            : t('quest.status.readyNoAi', { towns })
  return (
    <>
      <p role="status" className="sr-only">
        {status}
      </p>
      {route.name === 'results' ? (
        <ResultsScreen search={route.search} {...trip} />
      ) : (
        <QuestScreen search={route.search} cityId={route.cityId} destinations={trip.destinations} verdict={trip.verdict} onLevelUp={onLevelUp} />
      )}
    </>
  )
}

function Footer() {
  const { t } = useTranslation()
  const links: [string, string][] = [
    ['https://transitous.org/sources/', t('app.attribution.transit')],
    ['https://open-meteo.com/', t('app.attribution.weather')],
    ['https://opentripmap.io/', t('app.attribution.places')],
    ['https://www.openstreetmap.org/copyright', t('app.attribution.osm')],
  ]
  return (
    // Required by the data licences: Transitous sources, Open-Meteo, OpenTripMap and OpenStreetMap credits.
    <footer className="border-t border-line pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-0">
      <div className="mx-auto flex max-w-[640px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-[12px] leading-4 text-ink-muted sm:px-6 lg:max-w-[1248px] lg:px-12">
        <span>{t('app.version', { version: __APP_VERSION__ })}</span>
        {links.map(([href, label]) => (
          <a key={href} className="underline decoration-line underline-offset-2 hover:text-ink" href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ))}
      </div>
    </footer>
  )
}

function LevelUp({ level, onClose }: { level: number; onClose: () => void }) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal?.()
  }, [])
  const title = t(`progress.levels.${levelOf(levelStart(level)).title}`)
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="levelup-title"
      className="m-auto w-[min(92vw,380px)] rounded-lg border-2 border-ink bg-surface p-6 text-center backdrop:bg-ink/40 motion-safe:animate-pop"
    >
      <Wander mood="celebrating" size={170} className="mx-auto" />
      <h2 id="levelup-title" className="mt-3 text-[22px] leading-7 font-semibold">
        {t('progress.levelUp')}
      </h2>
      <p className="mt-1 text-ink-muted">{t('progress.levelUpText', { level, title })}</p>
      <p className="mt-2 font-semibold">{pickLine(t('wander.lines.celebrating', { returnObjects: true }) as string[], String(level))}</p>
      <form method="dialog" className="mt-5">
        <Button type="submit" className="w-full" autoFocus>
          {t('progress.close')}
        </Button>
      </form>
    </dialog>
  )
}
