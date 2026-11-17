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

  constructor(private readonly file?: string) {
    this.data = {}
    if (!file) return
    try {
      Object.assign(this.data, JSON.parse(readFileSync(file, 'utf-8')) as Record<string, V>)
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
  }

  save(): void {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data))
    renameSync(tmp, this.file)
  }
}
