import { UpstreamError, type Coordinates } from '../transit/types.js'
import type { Weather, WeatherProvider } from './types.js'

/**
 * Open-Meteo (https://open-meteo.com) - free for non-commercial use, no key, CC BY 4.0 (credit in the UI).
 * Limits (terms, 17.11.2026): < 10 000 calls/day, 5 000/hour, 600/minute. Many points go in one call.
 */

const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_probability_max',
  'precipitation_sum',
  'wind_speed_10m_max',
  'sunshine_duration',
] as const

type Daily = { time: string[] } & Record<(typeof DAILY)[number], (number | null)[]>
type Answer = { daily?: Daily }

export type OpenMeteoOptions = { userAgent: string; baseUrl?: string; timeoutMs?: number; fetch?: typeof fetch }

export class OpenMeteo implements WeatherProvider {
  readonly name = 'open-meteo'
  /** The forecast API answers up to 15 days ahead (16 days including today). */
  readonly horizonDays = 15
  /** Points per call: keeps the URL short; a search has ~30-40 towns. */
  static readonly BATCH = 50
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: OpenMeteoOptions) {
    this.fetchImpl = options.fetch ?? fetch
  }

  async daily(points: Coordinates[], date: string): Promise<(Weather | null)[]> {
    const out: (Weather | null)[] = []
    for (let i = 0; i < points.length; i += OpenMeteo.BATCH) {
      out.push(...(await this.batch(points.slice(i, i + OpenMeteo.BATCH), date)))
    }
    return out
  }

  private async batch(points: Coordinates[], date: string): Promise<(Weather | null)[]> {
    if (points.length === 0) return []
    const url = new URL('/v1/forecast', this.options.baseUrl ?? 'https://api.open-meteo.com')
    url.search = new URLSearchParams({
      latitude: points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: points.map((p) => p.lon.toFixed(4)).join(','),
      daily: DAILY.join(','),
      timezone: 'Europe/Berlin',
      start_date: date,
      end_date: date,
    }).toString()

    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
      })
    } catch (err) {
      throw new UpstreamError(this.name, `forecast failed: ${(err as Error).message}`)
    }
    if (!res.ok) throw new UpstreamError(this.name, `forecast answered HTTP ${res.status}`)
    let body: Answer | Answer[]
    try {
      body = (await res.json()) as Answer | Answer[]
    } catch {
      throw new UpstreamError(this.name, 'forecast answered something that is not JSON')
    }
    // One point → an object; several → a list in the same order.
    const answers = Array.isArray(body) ? body : [body]
    return points.map((_, i) => toWeather(answers[i]?.daily, date))
  }
}

function toWeather(d: Daily | undefined, date: string): Weather | null {
  if (!d || d.time?.[0] !== date) return null
  const v = (k: (typeof DAILY)[number]) => d[k]?.[0] ?? null
  const code = v('weather_code')
  const tempMax = v('temperature_2m_max')
  const tempMin = v('temperature_2m_min')
  if (code === null || tempMax === null || tempMin === null) return null
  return {
    date,
    code,
    tempMax,
    tempMin,
    precipitationProbability: v('precipitation_probability_max'),
    precipitationMm: v('precipitation_sum') ?? 0,
    windMaxKmh: v('wind_speed_10m_max') ?? 0,
    sunshineHours: Math.round(((v('sunshine_duration') ?? 0) / 3600) * 10) / 10,
  }
}
