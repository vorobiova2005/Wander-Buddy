import { expect, test, type Page } from '@playwright/test'
import { fakeApi } from '../src/test/fixtures'

/**
 * The step-07 criterion: choose a town → results → complete a quest → the experience grows.
 * Runs on a phone (bottom bar) and on a desktop (top bar).
 */

async function answerApiFromFixtures(page: Page) {
  const api = fakeApi()
  // Only the server's /api/... - not the app's own modules under /src/api/.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url())
    const res = await api(url.pathname + url.search)
    await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
  })
  // No map tiles from openstreetmap.org in tests: polite to OSM and independent of the network.
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort())
}

test.beforeEach(async ({ page }) => {
  await answerApiFromFixtures(page)
})

test('choose a town, open its quest, complete steps - XP and the visited town are saved', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/Привіт, я Вандер!/)).toBeVisible()

  // Where from: type, pick the suggested station.
  await page.getByRole('combobox').fill('Ful')
  await page.getByRole('option', { name: 'Fulda' }).click()
  await expect(page.getByRole('combobox')).toHaveValue('Fulda')
  await page.getByRole('button', { name: 'Знайти поїздки' }).click()

  // Results: the AI's top 3 and the map with its pins.
  await expect(page).toHaveURL(/\/results\?from=Fulda/)
  await expect(page.getByText('Готові до пригод? Ходімо!')).toBeVisible()
  const map = page.getByRole('region', { name: 'Мапа досяжних міст' })
  await expect(map).toBeVisible()
  // The start, the top 3 and the 4th town - the other towns stay off the map until their list is open.
  await expect(map.locator('.wb-pin--top')).toHaveCount(3)
  await expect(map.locator('.wb-pin--origin')).toHaveCount(1)
  await expect(map.locator('.wb-pin--dot')).toHaveCount(0)
  await page.getByRole('button', { name: /^Місце 1: Hünfeld/ }).click()

  // The quest.
  await expect(page.getByRole('heading', { name: 'Квест: День у Hünfeld' })).toBeVisible()
  await expect(page.getByText('0 / 3 · +0 XP')).toBeVisible()
  const next = page.getByRole('button', { name: 'Позначити крок виконаним' })
  await next.click()
  await next.click()
  await expect(page.getByText('2 / 3 · +30 XP')).toBeVisible()
  await expect(page.getByRole('img', { name: 'Вандер тримає величезний брецель' })).toBeVisible()
  await next.click()
  await expect(page.getByText('Квест пройдено! 🎉')).toBeVisible()
  await expect(next).toHaveCount(0)

  // Progress, through the navigation of this screen size.
  await page.getByRole('button', { name: 'Прогрес', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Прогрес' })).toBeVisible()
  await expect(page.getByText('45 / 50 XP')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Мапа відвіданих міст' }).locator('.wb-pin--top')).toHaveCount(1)

  // A reload keeps it: the progress lives in this browser.
  await page.reload()
  await expect(page.getByText('45 / 50 XP')).toBeVisible()
})

test('the layout fits the screen: no sideways scrolling, the right navigation', async ({ page }, info) => {
  const screens = [
    '/',
    '/results?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120',
    '/quest/hunfeld?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120',
    '/progress',
  ]
  // The phone project also tries the narrowest common Android width.
  const widths = info.project.name === 'phone' ? [page.viewportSize()!.width, 360] : [page.viewportSize()!.width]
  for (const width of widths) {
    await page.setViewportSize({ width, height: page.viewportSize()!.height })
    for (const url of screens) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `sideways scroll on ${url} at ${width} px`).toBeLessThanOrEqual(0)
    }
  }
  // Phone: the bottom bar, no top bar. Desktop: the top bar, no bottom bar.
  const phone = info.project.name === 'phone'
  const navs = page.getByRole('navigation', { name: 'Розділи' })
  await expect(navs).toHaveCount(1) // the other one is hidden for this screen size
  const box = (await navs.boundingBox())!
  const viewport = page.viewportSize()!
  if (phone) expect(box.y + box.height).toBeGreaterThan(viewport.height - 2)
  else expect(box.y).toBeLessThan(80)
})

test('clean URLs: a deep link opens its screen, an old #/ link moves to the clean one, back works', async ({ page }) => {
  await page.goto('/quest/hunfeld?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120')
  await expect(page.getByRole('heading', { name: 'Квест: День у Hünfeld' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Квест: День у Hünfeld' })).toBeVisible()

  await page.goto('/#/progress')
  await expect(page).toHaveURL(/\/progress$/)
  await expect(page.getByRole('heading', { name: 'Прогрес' })).toBeVisible()

  await page.goto('/results?from=Fulda&date=2026-11-21&time=09%3A00&maxMinutes=120')
  await page.getByRole('button', { name: /^Місце 1: Hünfeld/ }).click()
  await expect(page).toHaveURL(/\/quest\/hunfeld\?/)
  await page.goBack()
  await expect(page).toHaveURL(/\/results\?/)
  await expect(page.getByRole('heading', { name: 'Топ-3 від Вандера' })).toBeVisible()
})
