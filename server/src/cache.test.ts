import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PersistentMap, RateLimiter, TtlCache } from './cache.js'

describe('TtlCache', () => {
  it('forgets an entry after its time to live', () => {
    let now = 0
    const cache = new TtlCache<string>(1000, 10, () => now)
    cache.set('a', 'x')
    now = 999
    expect(cache.get('a')).toBe('x')
    now = 1000
    expect(cache.get('a')).toBeUndefined()
  })

  it('drops the oldest entry when full', () => {
    const cache = new TtlCache<number>(60_000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([undefined, 2, 3])
  })
})

describe('PersistentMap', () => {
  it('survives a restart through its file, null values included', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'wb-')), 'state', 'map.json')
    const first = new PersistentMap<string | null>(file)
    first.set('a', 'Kassel')
    first.set('b', null)
    first.save()

    const second = new PersistentMap<string | null>(file)
    expect(second.get('a')).toBe('Kassel')
    expect(second.has('b')).toBe(true)
    expect(second.get('b')).toBeNull()
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ a: 'Kassel', b: null })
  })

  it('works in memory without a file', () => {
    const map = new PersistentMap<number>()
    map.set('x', 1)
    map.save()
    expect(map.get('x')).toBe(1)
  })
})

describe('PersistentMap - writes only what changed', () => {
  const tempFile = () => join(mkdtempSync(join(tmpdir(), 'wb-')), 'map.json')

  it('does not create the file when nothing was set', () => {
    const file = tempFile()
    new PersistentMap<string>(file).save()
    expect(existsSync(file)).toBe(false)
  })

  it('does not rewrite a loaded file when nothing changed', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ a: 'Kassel' }))
    const map = new PersistentMap<string>(file)
    writeFileSync(file, 'marker') // a save would replace this
    map.save()
    expect(readFileSync(file, 'utf-8')).toBe('marker')
    expect(map.get('a')).toBe('Kassel')
  })

  it('writes after a set, and not again until the next set', () => {
    const file = tempFile()
    const map = new PersistentMap<string>(file)
    map.set('a', 'Kassel')
    map.save()
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ a: 'Kassel' })
    writeFileSync(file, 'marker')
    map.save()
    expect(readFileSync(file, 'utf-8')).toBe('marker')
    map.set('b', 'Fulda')
    map.save()
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ a: 'Kassel', b: 'Fulda' })
  })

  it('drops expired entries on load and writes the smaller file on the next save', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ old: { at: 1 }, fresh: { at: 100 } }))
    const map = new PersistentMap<{ at: number }>(file, (v) => v.at < 50)
    expect(map.has('old')).toBe(false)
    expect(map.get('fresh')).toEqual({ at: 100 })
    expect(map.size).toBe(1)
    map.save()
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ fresh: { at: 100 } })
  })

  it('starts empty from an unreadable file', () => {
    const file = tempFile()
    writeFileSync(file, 'not json')
    expect(new PersistentMap<string>(file).size).toBe(0)
  })
})

describe('RateLimiter', () => {
  it('allows `limit` takes per window, then frees a slot exactly windowMs after the oldest take', () => {
    let now = 0
    const limiter = new RateLimiter(2, 60_000, () => now)
    expect(limiter.tryTake()).toBe(true)
    now = 10_000
    expect(limiter.tryTake()).toBe(true)
    expect(limiter.tryTake()).toBe(false)
    now = 59_999
    expect(limiter.tryTake()).toBe(false)
    now = 60_000 // the take at 0 left the window
    expect(limiter.tryTake()).toBe(true)
    expect(limiter.tryTake()).toBe(false)
    now = 70_000 // the take at 10 000 left the window
    expect(limiter.tryTake()).toBe(true)
  })

  it('does not count refused takes', () => {
    let now = 0
    const limiter = new RateLimiter(1, 1000, () => now)
    expect(limiter.tryTake()).toBe(true)
    for (let i = 0; i < 5; i++) expect(limiter.tryTake()).toBe(false)
    now = 1000
    expect(limiter.tryTake()).toBe(true)
  })
})
