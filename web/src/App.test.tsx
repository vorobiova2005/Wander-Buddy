import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { resetProgressCache } from './lib/progress'
import { clearTripCache } from './lib/trip'
import { fakeApi, verdict } from './test/fixtures'

// Leaflet needs a real browser; here the map is a list of its pins (the e2e test sees the real one).
vi.mock('./components/TripMap', () => ({
  TripMap: ({ points, label }: { points: { id: string; label: string }[]; label: string }) => (
    <ul aria-label={label}>
      {points.map((p) => (
        <li key={p.id}>{p.label}</li>
      ))}
    </ul>
  ),
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetProgressCache()
  clearTripCache()
  window.location.hash = ''
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  vi.stubGlobal('fetch', vi.fn(fakeApi()))
})
afterEach(() => vi.unstubAllGlobals())

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
const RESULTS = '#/results?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120'

describe('search screen', () => {
  it('greets with Вандер and credits the data sources as their licences require', () => {
    render(<App />)
    expect(screen.getByText(/Привіт, я Вандер!/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Розклади: Transitous' })).toHaveAttribute('href', 'https://transitous.org/sources/')
    expect(screen.getByRole('link', { name: 'Погода: Open-Meteo.com' })).toHaveAttribute('href', 'https://open-meteo.com/')
    expect(screen.getByRole('link', { name: 'Місця: OpenTripMap' })).toHaveAttribute('href', 'https://opentripmap.io/')
    expect(screen.getByRole('link', { name: '© учасники OpenStreetMap' })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
    expect(screen.getByText(`Версія ${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('asks where from instead of searching for nothing', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Знайти поїздки' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Впиши, звідки рушаємо')
    expect(window.location.hash).toBe('')
  })

  it('suggests stations while typing and searches with the chosen one', async () => {
    render(<App />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ful' } })
    const option = await screen.findByRole('option', { name: 'Fulda' }, { timeout: 2000 })
    fireEvent.mouseDown(option)
    expect(screen.getByRole('combobox')).toHaveValue('Fulda')
    fireEvent.click(screen.getByRole('button', { name: 'Знайти поїздки' }))
    expect(window.location.hash).toMatch(/^#\/results\?from=Fulda&date=\d{4}-\d{2}-\d{2}&time=09%3A00&maxMinutes=120$/)
  })

  it('makes Вандер sleepy for a departure before seven', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Виїзд о'), { target: { value: '06:15' } })
    expect(screen.getAllByRole('img', { name: 'Вандер позіхає з кавою' }).length).toBeGreaterThan(0)
  })
})

describe('results', () => {
  it("shows the AI's top 3 with reasons, the warnings and the other towns", async () => {
    go(RESULTS)
    render(<App />)
    expect(await screen.findByText('Готові до пригод? Ходімо!')).toBeInTheDocument()
    const top = screen.getByRole('heading', { name: 'Топ-3 від Вандера' }).parentElement!
    // The whole card is read: rank, town, trip, weather, places, score - and what a tap does.
    expect(within(top).getAllByRole('button')).toHaveLength(3)
    within(top).getByRole('button', {
      name: 'Місце 1: Hünfeld, 35 хв · без пересадок · прибуття 09:35, дощ, 1…7 °C · опади 39 %, 6 місць, 62,8 бала. Відкрити квест у Hünfeld',
    })
    within(top).getByRole('button', { name: /^Місце 2: Schlüchtern/ })
    within(top).getByRole('button', { name: /^Місце 3: Steinau an der Straße/ })
    expect(screen.getByText('Найкоротша поїздка і музей.')).toBeInTheDocument()
    expect(screen.getByText('Перевір поїзд назад увечері.')).toBeInTheDocument()
    expect(screen.getByText('Fulda · сб 21.11 · 09:00 · до 2 год · 4 міста')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ще 1 місто' }))
    expect(screen.getByRole('button', { name: /^Місце 4: Bebra/ })).toBeInTheDocument()
  })

  it('without the AI shows the top 3 by the formula and says so', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeApi({ verdict: { ...verdict, verdict: null, ai: { ...verdict.ai, status: 'unavailable' } } })))
    go(RESULTS)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Топ-3 за балами' })).toBeInTheDocument()
    expect(screen.getByText(/Порада AI зараз недоступна/)).toBeInTheDocument()
  })

  it('when the data source is down, Вандер is lost and offers to try again', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeApi({ destinations: 'fail' })))
    go(RESULTS)
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Джерело даних зараз не відповідає')
    expect(screen.getByRole('img', { name: /розгублено/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Спробувати ще раз' })).toBeInTheDocument()
  })
})

describe('quest and progress', () => {
  it('completing quest steps gives XP, a new level, a visited town and badges', async () => {
    go(RESULTS)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /^Місце 1: Hünfeld/ }))
    expect(window.location.hash).toMatch(/^#\/quest\/hunfeld\?/)
    expect(await screen.findByRole('heading', { name: 'Квест: День у Hünfeld' })).toBeInTheDocument()
    expect(screen.getByText('0 / 3 · +0 XP')).toBeInTheDocument()

    const next = screen.getByRole('button', { name: 'Позначити крок виконаним' })
    fireEvent.click(next)
    fireEvent.click(next)
    expect(screen.getByText('2 / 3 · +30 XP')).toBeInTheDocument()
    // The next step is coffee: Вандер is hungry.
    expect(screen.getByRole('img', { name: 'Вандер тримає величезний брецель' })).toBeInTheDocument()

    fireEvent.click(next) // 45 XP - still level 1
    expect(screen.getByText('Квест пройдено! 🎉')).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('button', { name: 'Позначити крок виконаним' })).not.toBeInTheDocument()

    // Undo and redo a step: XP follows.
    fireEvent.click(screen.getByRole('button', { name: /^10:00 Музей/, pressed: true }))
    expect(screen.getByText('2 / 3 · +25 XP')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^10:00 Музей/, pressed: false }))

    go('#/progress')
    expect(await screen.findByRole('heading', { name: 'Прогрес' })).toBeInTheDocument()
    expect(screen.getByText('Рівень 1 · Новачок')).toBeInTheDocument()
    expect(screen.getByText('45 / 50 XP')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Мапа відвіданих міст' })).toHaveTextContent('✓ Hünfeld')
    expect(screen.getByText('Перший потяг')).toHaveTextContent('отримано')
    expect(screen.getByText('Квест пройдено')).toHaveTextContent('отримано')
    expect(screen.getByText('10 міст')).toHaveTextContent('ще ні')
    expect(JSON.parse(localStorage.getItem('wb.progress.v1')!).quests['2026-11-21|hunfeld'].done).toHaveProperty('2')
  })

  it('a step that crosses a level shows the level-up moment', async () => {
    localStorage.setItem(
      'wb.progress.v1',
      JSON.stringify({
        v: 1,
        since: '2026-11-14',
        quests: { old: { key: 'old', cityId: 'x', cityName: 'X', center: { lat: 50, lon: 9 }, date: '2026-11-14', steps: 5, done: { 0: { xp: 45, at: '' } }, rainy: false, early: false } },
      }),
    )
    resetProgressCache()
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    go('#/quest/hunfeld?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Позначити крок виконаним' }))
    expect(screen.getByRole('heading', { name: 'Новий рівень!' })).toBeInTheDocument()
    expect(screen.getByText('Рівень 2 - твоє звання «Пасажир».')).toBeInTheDocument()
  })
})
