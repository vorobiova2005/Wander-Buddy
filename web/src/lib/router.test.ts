import { describe, expect, it } from 'vitest'
import { parseRoute } from './router'

const QUERY = 'date=2026-11-21&time=09:00&maxMinutes=120'

describe('parseRoute with links broken on the way', () => {
  it('sends a quest link with a cut-off escape (%E0) to the search instead of throwing', () => {
    expect(() => parseRoute(`/quest/%E0?from=Fulda&${QUERY}`)).not.toThrow()
    expect(parseRoute(`/quest/%E0?from=Fulda&${QUERY}`)).toEqual({ name: 'search' })
  })

  it.each([
    ['empty lat and lon', `lat=&lon=&${QUERY}`],
    ['blank lat and lon', `lat=%20&lon=%20&${QUERY}`],
    ['empty lat and lon next to a town', `from=Fulda&lat=&lon=&${QUERY}`],
    ['a latitude beyond the pole', `lat=95&lon=9.68&${QUERY}`],
    ['a longitude beyond 180', `lat=50.55&lon=181&${QUERY}`],
    ['a latitude that is not a number', `lat=north&lon=9.68&${QUERY}`],
  ])('does not take %s as a search', (_, query) => {
    expect(parseRoute(`/results?${query}`)).toEqual({ name: 'search' })
  })

  it('takes a point on the edge of the valid range', () => {
    expect(parseRoute(`/results?lat=-90&lon=180&${QUERY}`)).toEqual({
      name: 'results',
      search: { from: '', lat: -90, lon: 180, date: '2026-11-21', time: '09:00', maxMinutes: 120 },
    })
  })

  it('keeps a day long gone as a results route - the server answers date_out_of_range', () => {
    expect(parseRoute('/results?from=Fulda&date=2020-01-01&time=09:00&maxMinutes=120')).toEqual({
      name: 'results',
      search: { from: 'Fulda', date: '2020-01-01', time: '09:00', maxMinutes: 120 },
    })
  })
})
