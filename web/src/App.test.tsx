import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Search } from './api/client'
import { resetProgressCache, saveProgress } from './lib/progress'
import { navigate } from './lib/router'
import { addDays, todayBerlin, weekendDays } from './lib/time'
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
  window.history.replaceState(null, '', '/')
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  vi.stubGlobal('fetch', vi.fn(fakeApi()))
})
afterEach(() => vi.unstubAllGlobals())

const go = (url: string) =>
  act(() => {
    window.history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
const RESULTS = '/results?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120'

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
    expect(window.location.pathname).toBe('/')
  })

  it('suggests stations while typing and searches with the chosen one', async () => {
    render(<App />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ful' } })
    const option = await screen.findByRole('option', { name: 'Fulda' }, { timeout: 2000 })
    fireEvent.mouseDown(option)
    expect(screen.getByRole('combobox')).toHaveValue('Fulda')
    fireEvent.click(screen.getByRole('button', { name: 'Знайти поїздки' }))
    expect(window.location.pathname + window.location.search).toMatch(/^\/results\?from=Fulda&date=\d{4}-\d{2}-\d{2}&time=09%3A00&maxMinutes=120$/)
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
    expect(window.location.pathname).toBe('/quest/hunfeld')
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

    go('/progress')
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
    go('/quest/hunfeld?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Позначити крок виконаним' }))
    expect(screen.getByRole('heading', { name: 'Новий рівень!' })).toBeInTheDocument()
    expect(screen.getByText('Рівень 2 - твоє звання «Пасажир».')).toBeInTheDocument()
  })
})

/** A fetch whose destinations answer with a server error code. */
const failingWith = (code: string, status: number) => {
  const answer = fakeApi()
  return vi.fn(async (input: string | URL | Request) =>
    String(input).startsWith('/api/destinations')
      ? new Response(JSON.stringify({ ok: false, error: { code, message: code } }), { status, headers: { 'Content-Type': 'application/json' } })
      : answer(input),
  )
}

describe('results errors', () => {
  it.each([
    ['origin_outside', 400, 'Пошук працює лише по Німеччині. Обери місто або станцію в Німеччині.'],
    ['date_out_of_range', 400, 'Цей день уже минув або ще надто далеко. Обери дату в межах 60 днів.'],
    ['busy', 429, 'Зараз забагато нових пошуків. Спробуй ще раз за хвилину.'],
    ['something_new', 500, 'Щось пішло не так. Спробуй ще раз.'],
  ])('the server code %s shows its own message', async (code, status, message) => {
    vi.stubGlobal('fetch', failingWith(code, status))
    go(RESULTS)
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('an old shared link still opens the results and says the day is out of range', async () => {
    vi.stubGlobal('fetch', failingWith('date_out_of_range', 400))
    go('/results?from=Fulda&date=2020-01-01&time=09%3A00&maxMinutes=120')
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Цей день уже минув')
  })
})

describe('broken or unsaved progress', () => {
  it('a hand-edited progress with an empty quest does not crash the app: level 1', () => {
    localStorage.setItem('wb.progress.v1', '{"v":1,"since":null,"quests":{"x":{}}}')
    resetProgressCache()
    render(<App />)
    expect(screen.getAllByText('Рівень 1').length).toBeGreaterThan(0)
  })

  it('a progress that is not JSON at all starts fresh', () => {
    localStorage.setItem('wb.progress.v1', '{"v":1,"quests":')
    resetProgressCache()
    go('/progress')
    render(<App />)
    expect(screen.getByText('Рівень 1 · Новачок')).toBeInTheDocument()
  })

  it('the progress screen says so when the browser keeps nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    try {
      saveProgress({ v: 1, since: null, quests: {} })
      go('/progress')
      render(<App />)
      expect(
        screen.getByText('Браузер не зберігає прогрес (приватний режим або заблоковане сховище): після закриття вкладки досвід зникне.'),
      ).toBeInTheDocument()
    } finally {
      setItem.mockRestore()
      saveProgress({ v: 1, since: null, quests: {} })
    }
  })

  it('the progress screen keeps quiet when the progress is stored', () => {
    go('/progress')
    render(<App />)
    expect(screen.queryByText(/Браузер не зберігає прогрес/)).not.toBeInTheDocument()
  })
})

describe('back to the search', () => {
  const day = weekendDays(todayBerlin())[0]
  const back = async (search: Search) => {
    render(<App />)
    act(() => navigate({ name: 'results', search }))
    // Wait for the loaded screen: the button of the loading one is replaced when the towns come.
    await screen.findByRole('heading', { name: 'Топ-3 від Вандера' })
    fireEvent.click(screen.getByRole('button', { name: 'Новий пошук' }))
    expect(window.location.pathname).toBe('/')
  }

  it('restores the town, the time and the limit of the last results', async () => {
    await back({ from: 'Hünfeld', date: day, time: '10:15', maxMinutes: 150 })
    expect(screen.getByRole('combobox')).toHaveValue('Hünfeld')
    expect(screen.getByLabelText('Виїзд о')).toHaveValue('10:15')
    expect(screen.getByRole('slider')).toHaveValue('150')
  })

  it('restores "my place" for a search by position', async () => {
    await back({ from: '', lat: 50.55, lon: 9.68, date: day, time: '07:30', maxMinutes: 90 })
    expect(screen.getByRole('combobox')).toHaveValue('Моє місце')
    expect(screen.getByLabelText('Виїзд о')).toHaveValue('07:30')
    expect(screen.getByRole('slider')).toHaveValue('90')
  })

  it('a later day outside this weekend is restored as another date', async () => {
    await back({ from: 'Fulda', date: addDays(todayBerlin(), 20), time: '09:00', maxMinutes: 120 })
    expect(screen.getByRole('button', { name: 'Інша дата', pressed: true })).toBeInTheDocument()
  })
})

describe('"I am here"', () => {
  type Success = (pos: { coords: { latitude: number; longitude: number } }) => void
  type Failure = (err: { code: number; PERMISSION_DENIED: 1; POSITION_UNAVAILABLE: 2; TIMEOUT: 3; message: string }) => void
  let onSuccess: Success = () => {}
  let onFailure: Failure = () => {}
  beforeEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((ok: Success, fail: Failure) => {
          onSuccess = ok
          onFailure = fail
        }),
      },
    })
  })
  afterEach(() => {
    delete (navigator as { geolocation?: unknown }).geolocation
  })
  const fail = (code: number) => act(() => onFailure({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' }))

  it('uses the position when it arrives', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Я тут' }))
    expect(screen.getByRole('button', { name: 'Шукаю…' })).toBeDisabled()
    act(() => onSuccess({ coords: { latitude: 50.55, longitude: 9.68 } }))
    expect(screen.getByRole('combobox')).toHaveValue('Моє місце')
  })

  it('ignores a position that arrives after the user typed a town', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Я тут' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Fulda' } })
    act(() => onSuccess({ coords: { latitude: 50.55, longitude: 9.68 } }))
    expect(screen.getByRole('combobox')).toHaveValue('Fulda')
    expect(screen.getByRole('button', { name: 'Я тут' })).toBeEnabled()
  })

  it.each([
    [1, 'Немає доступу до геолокації. Дозволь його в браузері або впиши місто.'],
    [3, 'Не встиг визначити, де ти. Спробуй ще раз або впиши місто.'],
    [2, 'Не вдалося визначити, де ти. Впиши місто.'],
  ])('error code %i gives its own advice', (code, message) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Я тут' }))
    fail(code)
    expect(screen.getByRole('alert')).toHaveTextContent(message)
  })

  it('keeps quiet about a failure after the user typed a town', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Я тут' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Fulda' } })
    fail(3)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('tab title', () => {
  it('names each screen in the document title', async () => {
    render(<App />)
    expect(document.title).toBe('Куди поїхати · Wander Buddy')
    go('/progress')
    expect(document.title).toBe('Мій прогрес · Wander Buddy')
    go(RESULTS)
    expect(document.title).toBe('Поїздки · Wander Buddy')
    go('/quest/hunfeld?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120')
    expect(document.title).toBe('Квест · Wander Buddy')
    await screen.findByRole('heading', { name: 'Квест: День у Hünfeld' })
  })
})
