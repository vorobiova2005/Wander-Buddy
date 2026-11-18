import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** In-memory cache with a time to live. Enough for one server process. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expires: number }>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key)
    if (!hit) return undefined
    if (hit.expires <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return hit.value
  }

  /** `ttlMs` overrides the default time to live for this one entry. */
  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expires: this.now() + ttlMs })
  }
}

/**
 * A key-value map kept in a JSON file, for facts that do not change (which town a station is in).
 * Loaded once at start; written atomically (temp file + rename). Without a file it is memory-only.
 */
export class PersistentMap<V> {
  private readonly data: Record<string, V>
  /** Changed since the last save: a search that learnt nothing new does not rewrite the file. */
  private dirty = false

  /** `expired` drops outdated entries on load, so the file does not grow for ever. */
  constructor(
    private readonly file?: string,
    expired?: (value: V) => boolean,
  ) {
    this.data = {}
    if (!file) return
    try {
      const loaded = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, V>
      for (const [k, v] of Object.entries(loaded)) {
        if (expired?.(v)) this.dirty = true
        else this.data[k] = v
      }
    } catch {
      // No file yet (first start) or unreadable: start empty, it is only a cache.
    }
  }

  get size(): number {
    return Object.keys(this.data).length
  }

  has(key: string): boolean {
    return Object.hasOwn(this.data, key)
  }

  get(key: string): V | undefined {
    return this.data[key]
  }

  set(key: string, value: V): void {
    this.data[key] = value
    this.dirty = true
  }

  save(): void {
    if (!this.file || !this.dirty) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
    this.dirty = false
  }
}

/** The server is at its limit of fresh work for the moment (RateLimiter): HTTP 429, try again in a minute. */
export class BusyError extends Error {
  constructor(message = 'Too many new searches right now') {
    super(message)
    this.name = 'BusyError'
  }
}

/**
 * At most `limit` takes per `windowMs` (a sliding window), for the whole server. Guards the free external sources:
 * a script cycling through departure times must not turn into hundreds of searches at Transitous or calls to the AI.
 */
export class RateLimiter {
  private readonly taken: number[] = []

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryTake(): boolean {
    const t = this.now()
    while (this.taken.length && this.taken[0] <= t - this.windowMs) this.taken.shift()
    if (this.taken.length >= this.limit) return false
    this.taken.push(t)
    return true
  }
}
