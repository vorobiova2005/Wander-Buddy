import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PersistentMap, TtlCache } from './cache.js'

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
