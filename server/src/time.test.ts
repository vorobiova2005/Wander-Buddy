import { describe, expect, it } from 'vitest'
import { isValidDateTime, todayIn, zonedTimeToUtc } from './time.js'

describe('zonedTimeToUtc', () => {
  it('converts Berlin winter time (UTC+1)', () => {
    expect(zonedTimeToUtc('2026-11-21', '09:00').toISOString()).toBe('2026-11-21T08:00:00.000Z')
  })

  it('converts Berlin summer time (UTC+2)', () => {
    expect(zonedTimeToUtc('2026-07-04', '09:00').toISOString()).toBe('2026-07-04T07:00:00.000Z')
  })

  it('handles the day the clocks go back', () => {
    expect(zonedTimeToUtc('2026-10-25', '12:00').toISOString()).toBe('2026-10-25T11:00:00.000Z')
  })
})

describe('todayIn', () => {
  it('gives the date in the time zone, not in UTC', () => {
    // 23:30 UTC on 20.11 is already 21.11 in Berlin
    expect(todayIn('Europe/Berlin', new Date('2026-11-20T23:30:00Z'))).toBe('2026-11-21')
  })
})

describe('isValidDateTime', () => {
  it.each([
    ['2026-11-21', '09:00', true],
    ['2028-02-29', '23:59', true],
    ['2026-02-31', '09:00', false],
    ['2026-13-01', '09:00', false],
    ['2026-11-21', '25:99', false],
    ['21.11.2026', '09:00', false],
  ])('%s %s → %s', (date, time, ok) => {
    expect(isValidDateTime(date, time)).toBe(ok)
  })
})
