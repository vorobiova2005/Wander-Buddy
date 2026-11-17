/**
 * Checks that the API keys in the environment are present and accepted by their services.
 * Prints only a verdict per key and public facts (HTTP status, available models, rate limits) -
 * never the key values. Run: `npm run keys:check -w server` (reads ../.env if it exists).
 */

type Verdict = { name: string; ok: boolean; details: string }

async function checkGroq(key: string | undefined): Promise<Verdict> {
  const name = 'GROQ_API_KEY'
  if (!key) return { name, ok: false, details: 'missing' }
  const headers = { Authorization: `Bearer ${key}` }

  const models = await fetch('https://api.groq.com/openai/v1/models', { headers })
  if (!models.ok) return { name, ok: false, details: `rejected (HTTP ${models.status})` }
  const ids = ((await models.json()) as { data: { id: string }[] }).data.map((m) => m.id).sort()

  // One tiny completion per candidate model for the AI verdict: the response headers carry this
  // account's real limits for that model.
  const candidates = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].filter((m) => ids.includes(m))
  const lines: string[] = []
  let ok = candidates.length > 0
  for (const model of candidates) {
    const chat = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 16 }),
    })
    const h = (k: string) => chat.headers.get(k) ?? '?'
    ok &&= chat.ok
    lines.push(`${model}: HTTP ${chat.status}, requests/day ${h('x-ratelimit-limit-requests')}, tokens/min ${h('x-ratelimit-limit-tokens')}`)
  }
  return { name, ok, details: [`models: ${ids.length} (${ids.join(', ')})`, ...lines].join('\n    ') }
}

async function checkOpenTripMap(key: string | undefined): Promise<Verdict> {
  const name = 'OPENTRIPMAP_API_KEY'
  if (!key) return { name, ok: false, details: 'missing' }
  const url = new URL('https://api.opentripmap.com/0.1/en/places/geoname')
  url.search = new URLSearchParams({ name: 'Fulda', apikey: key }).toString()
  const res = await fetch(url)
  if (!res.ok) return { name, ok: false, details: `rejected (HTTP ${res.status})` }
  const body = (await res.json()) as { name?: string; country?: string; lat?: number; lon?: number }
  return { name, ok: true, details: `geoname Fulda → ${body.name}, ${body.country} (${body.lat}, ${body.lon})` }
}

const results = await Promise.all([
  checkGroq(process.env.GROQ_API_KEY),
  checkOpenTripMap(process.env.OPENTRIPMAP_API_KEY),
])
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}: ${r.details}`)
process.exitCode = results.every((r) => r.ok) ? 0 : 1
