import { UpstreamError } from '../transit/types.js'
import type { AiProvider, ChatMessage } from './types.js'

/**
 * Groq (https://console.groq.com) - OpenAI-compatible chat completions. Free plan on 17.11.2026: per model
 * 1 000 requests a day and 8 000 tokens a minute (measured with `npm run keys:check -w server`).
 * The key never leaves the server; error messages never contain it.
 */

export type GroqOptions = {
  apiKey: string
  model: string
  userAgent: string
  baseUrl?: string
  timeoutMs?: number
  maxTokens?: number
  fetch?: typeof fetch
}

type Completion = {
  choices?: { message?: { content?: string | null } }[]
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

/** Aborts when either signal does. */
const anySignal = (a: AbortSignal, b?: AbortSignal) => (b ? AbortSignal.any([a, b]) : a)

export class Groq implements AiProvider {
  readonly name = 'groq'
  readonly model: string
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: GroqOptions) {
    this.model = options.model
    this.fetchImpl = options.fetch ?? fetch
  }

  async completeJson(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    const url = new URL('/openai/v1/chat/completions', this.options.baseUrl ?? 'https://api.groq.com')
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': this.options.userAgent,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          // JSON mode: the answer is one JSON object; its shape is checked by the caller against the schema.
          response_format: { type: 'json_object' },
          temperature: 0.4,
          max_tokens: this.options.maxTokens ?? 2500,
          // Reasoning models think before answering; little thinking keeps the JSON within max_tokens and the
          // tokens-per-minute quota.
          ...(this.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
        }),
        signal: anySignal(AbortSignal.timeout(this.options.timeoutMs ?? 45_000), signal),
      })
    } catch (err) {
      throw new UpstreamError(this.name, `chat failed: ${(err as Error).message}`)
    }
    if (!res.ok) throw new UpstreamError(this.name, `chat answered HTTP ${res.status}`)
    let body: Completion
    try {
      body = (await res.json()) as Completion
    } catch {
      throw new UpstreamError(this.name, 'chat answered something that is not JSON')
    }
    const content = body.choices?.[0]?.message?.content
    // Measured cost per call, for the quota (8 000 tokens a minute on the free plan).
    if (body.usage) {
      console.log(`AI ${this.model}: ${body.usage.prompt_tokens} in + ${body.usage.completion_tokens} out = ${body.usage.total_tokens} tokens`)
    }
    if (!content) throw new UpstreamError(this.name, 'chat answered without content')
    return content
  }
}
