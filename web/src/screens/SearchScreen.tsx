import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type Search } from '../api/client'
import type { Station } from '../api/types'
import { WanderSays } from '../components/Wander'
import { Button, Card, useDuration } from '../components/ui'
import { chooseMood, pickLine } from '../lib/mood'
import { lastResults, navigate } from '../lib/router'
import { addDays, shortDay, todayBerlin, weekendDays } from '../lib/time'

const LAST = 'wb.lastSearch'
type Remembered = { from: string; time: string; maxMinutes: number }

function remembered(): Remembered {
  try {
    const r = JSON.parse(localStorage.getItem(LAST) ?? 'null') as Remembered | null
    if (r && typeof r.from === 'string' && /^\d\d:\d\d$/.test(r.time) && Number.isInteger(r.maxMinutes)) return r
  } catch {
    // nothing remembered
  }
  return { from: '', time: '09:00', maxMinutes: 120 }
}

type Origin = { kind: 'name'; text: string } | { kind: 'point'; lat: number; lon: number }

/**
 * Where the form starts: the search of this tab's last results (back from the results - the same search, "my place"
 * and the day included), else what was remembered from an earlier visit.
 */
function startingPoint(today: string): { origin: Origin; date: string | null; time: string; maxMinutes: number } {
  const last = lastResults()
  const s = last && 'search' in last ? last.search : null
  if (s && s.date >= today) {
    const origin: Origin = s.lat !== undefined && s.lon !== undefined ? { kind: 'point', lat: s.lat, lon: s.lon } : { kind: 'name', text: s.from }
    return { origin, date: s.date, time: s.time, maxMinutes: s.maxMinutes }
  }
  const r = remembered()
  return { origin: { kind: 'name', text: r.from }, date: null, time: r.time, maxMinutes: r.maxMinutes }
}

/** The device is not on German time: the departure is still read as German time, so the form says so. */
const notBerlinTime = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Berlin'
  } catch {
    return false
  }
}

/** Screen 1 - where from, when, how long on the way. */
export function SearchScreen() {
  const { t } = useTranslation()
  const duration = useDuration()
  const today = todayBerlin()
  const weekend = weekendDays(today)
  const [start] = useState(() => startingPoint(today))

  const [origin, setOrigin] = useState<Origin>(start.origin)
  const [date, setDate] = useState(start.date ?? weekend[0])
  const [otherDate, setOtherDate] = useState(start.date !== null && !weekend.includes(start.date))
  const [time, setTime] = useState(start.time)
  const [maxMinutes, setMaxMinutes] = useState(start.maxMinutes)
  const [error, setError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  // Bumped on every edit of the origin: a position that arrives after the user typed a town is not used.
  const edits = useRef(0)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = origin.kind === 'name' ? origin.text.trim() : ''
    if (origin.kind === 'name' && text.length < 2) {
      setError(t('search.fromEmpty'))
      document.getElementById('origin')?.focus()
      return
    }
    // A tab left open past midnight still holds yesterday's day: search the next weekend day instead.
    const day = date < today ? weekend[0] : date
    const search: Search =
      origin.kind === 'point'
        ? { from: '', lat: origin.lat, lon: origin.lon, date: day, time, maxMinutes }
        : { from: text, date: day, time, maxMinutes }
    try {
      localStorage.setItem(LAST, JSON.stringify({ from: text, time, maxMinutes }))
    } catch {
      // not remembered - fine
    }
    navigate({ name: 'results', search })
  }

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setError(t('search.hereUnsupported'))
      return
    }
    setLocating(true)
    setError(null)
    const before = edits.current
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        if (edits.current !== before) return // the user typed a town meanwhile - that wins
        setOrigin({ kind: 'point', lat: pos.coords.latitude, lon: pos.coords.longitude })
      },
      (err) => {
        setLocating(false)
        if (edits.current !== before) return
        // Denied, too slow (indoors), or no position at all - each has its own advice.
        const key = err.code === err.PERMISSION_DENIED ? 'hereDenied' : err.code === err.TIMEOUT ? 'hereTimeout' : 'hereUnavailable'
        setError(t(`search.${key}`))
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  const [berlinHint] = useState(notBerlinTime)
  const mood = chooseMood({ departure: time })
  const line = mood === 'sleepy' ? pickLine(t('wander.lines.sleepy', { returnObjects: true }) as string[], time) : t('wander.greeting')

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_520px] lg:items-start lg:gap-12 lg:pt-8">
      <section className="space-y-6" aria-labelledby="search-title">
        <div className="space-y-3 max-lg:sr-only">
          <h1 id="search-title" className="text-[28px] leading-[34px] font-bold lg:text-[34px] lg:leading-[42px]">
            {t('search.title')}
          </h1>
          <p className="max-w-xl text-ink-muted">{t('search.lead')}</p>
        </div>
        <WanderSays mood={mood} line={line} size={140} artClassName="lg:h-[190px] lg:w-[146px]" />
        <ul className="hidden gap-4 lg:grid lg:grid-cols-3">
          {(['reach', 'weather', 'quest'] as const).map((k, i) => (
            <li key={k}>
              <Card className="h-full space-y-1.5 p-4">
                <span aria-hidden className="text-[22px]">{['🚆', '🌤️', '🗺️'][i]}</span>
                <p className="font-bold">{t(`search.how.${k}.title`)}</p>
                <p className="text-[13px] leading-[18px] text-ink-muted">{t(`search.how.${k}.text`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <form onSubmit={submit} noValidate className="space-y-5" aria-labelledby="search-title">
        <Card className="space-y-4 p-4">
          <div className="space-y-2">
            <label htmlFor="origin" className="label block">
              {t('search.from')}
            </label>
            <div className="flex gap-2">
              <OriginInput
                invalid={error !== null}
                origin={origin}
                onChange={(o) => {
                  edits.current++
                  setOrigin(o)
                  setError(null)
                }}
              />
              <Button variant="secondary" onClick={locate} disabled={locating} className="shrink-0 px-5">
                {locating ? t('search.hereBusy') : t('search.here')}
              </Button>
            </div>
            {error && (
              <p id="origin-error" role="alert" className="text-[13px] leading-[18px] font-semibold text-danger-strong">
                {error}
              </p>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="label mb-2">{t('search.when')}</legend>
            <div className="flex flex-wrap gap-2">
              {weekend.map((d) => (
                <DateChip key={d} selected={!otherDate && date === d} onClick={() => { setOtherDate(false); setDate(d) }}>
                  {d === today ? t('search.todayDate', { date: shortDay(d).split(' ')[1] }) : capitalise(shortDay(d))}
                </DateChip>
              ))}
              <DateChip selected={otherDate} onClick={() => setOtherDate(true)}>
                {t('search.otherDate')}
              </DateChip>
            </div>
            {otherDate && (
              <label className="flex items-center gap-3">
                <span className="text-ink-muted">{t('search.date')}</span>
                <input
                  type="date"
                  value={date}
                  min={today}
                  max={addDays(today, 60)}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="min-h-11 rounded-md border-2 border-line bg-bg px-3 font-bold"
                />
              </label>
            )}
            <label className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <span className="text-ink-muted">{t('search.departAt')}</span>
              <input
                type="time"
                value={time}
                step={300}
                onChange={(e) => e.target.value && setTime(e.target.value)}
                className="min-h-11 rounded-md border-2 border-line bg-bg px-3 font-bold tabular-nums"
              />
              {berlinHint && <span className="text-[13px] leading-[18px] text-ink-muted">{t('search.berlinTime')}</span>}
            </label>
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="limit" className="label block">
              {t('search.howLong')}
            </label>
            <div className="flex items-center gap-4">
              <input
                id="limit"
                type="range"
                min={30}
                max={180}
                step={15}
                value={maxMinutes}
                onChange={(e) => setMaxMinutes(Number(e.target.value))}
                aria-valuetext={t('unit.upTo', { value: duration(maxMinutes) })}
                className="h-11 flex-1 cursor-pointer accent-primary"
              />
              <output htmlFor="limit" className="w-28 text-right font-bold whitespace-nowrap">
                {t('unit.upTo', { value: duration(maxMinutes) })}
              </output>
            </div>
          </div>
        </Card>

        <Button type="submit" className="w-full text-[16px]">
          {t('search.submit')}
        </Button>
        <p className="text-[13px] leading-[18px] text-ink-muted">{t('search.note')}</p>
      </form>
    </div>
  )
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function DateChip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 rounded-full px-3.5 text-[14px] font-semibold transition-colors
        ${selected ? 'bg-accent text-ink' : 'bg-surface-alt text-ink hover:bg-line'}`}
    >
      {children}
    </button>
  )
}

/** The origin: free text with station suggestions from the server (a WAI-ARIA combobox), or "my place". */
function OriginInput({ origin, onChange, invalid }: { origin: Origin; onChange: (o: Origin) => void; invalid: boolean }) {
  const { t } = useTranslation()
  const listId = useId()
  const [suggestions, setSuggestions] = useState<Station[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const text = origin.kind === 'name' ? origin.text : ''

  useEffect(() => {
    const q = text.trim()
    if (origin.kind !== 'name' || q.length < 2) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      api
        .stations(q, ctrl.signal)
        .then((list) => {
          // Several stops can share a name (Fulda bus and rail); the search only needs the name once.
          setSuggestions(list.filter((st, i) => list.findIndex((o) => o.name === st.name) === i))
          setActive(-1)
        })
        .catch(() => setSuggestions([]))
    }, 250)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [text, origin.kind])

  const shown = open && text.trim().length >= 2 ? suggestions : []
  const choose = (s: Station) => {
    onChange({ kind: 'name', text: s.name })
    setOpen(false)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && !open && suggestions.length) {
      e.preventDefault()
      setOpen(true) // reopen after Escape
    } else if (e.key === 'ArrowDown' && shown.length) {
      e.preventDefault()
      setActive((a) => (a + 1) % shown.length)
    } else if (e.key === 'ArrowUp' && shown.length) {
      e.preventDefault()
      setActive((a) => (a <= 0 ? shown.length - 1 : a - 1))
    } else if (e.key === 'Enter' && active >= 0 && shown[active]) {
      e.preventDefault()
      choose(shown[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative min-w-0 flex-1">
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[15px]">
        📍
      </span>
      <input
        id="origin"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={origin.kind === 'point' ? t('results.myPlace') : text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? 'origin-error' : undefined}
        placeholder={t('search.fromPlaceholder')}
        onChange={(e) => {
          // Typing over "my place" starts a fresh name, not "Моє місцеF".
          const value = origin.kind === 'point' ? e.target.value.replace(t('results.myPlace'), '') : e.target.value
          onChange({ kind: 'name', text: value })
          setActive(-1)
          setOpen(true)
        }}
        onFocus={(e) => {
          if (origin.kind === 'point') e.target.select()
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        className="min-h-12 w-full rounded-md border-2 border-line bg-bg pr-3 pl-9 font-bold placeholder:font-medium placeholder:text-ink-muted/80 focus:border-primary"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={t('search.suggestions')}
        className={`absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border-2 border-line bg-surface shadow-lg ${shown.length ? '' : 'hidden'}`}
      >
        {shown.map((s, i) => (
          <li
            key={s.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(s)
            }}
            className={`cursor-pointer px-3 py-2.5 ${i === active ? 'bg-primary-soft' : 'hover:bg-surface-alt'}`}
          >
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
