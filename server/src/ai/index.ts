import { USER_AGENT } from '../transit/index.js'
import { Groq } from './groq.js'
import type { AiProvider } from './types.js'

export * from './types.js'

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'

/**
 * The registry of AI sources. To add one: implement AiProvider in its own file, add a line here, set AI_PROVIDER.
 * Without a key the answer still comes - the computed ranking without the AI verdict.
 */
const aiProviders: Record<string, () => AiProvider | null> = {
  groq: () => {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      console.warn('GROQ_API_KEY is not set: answers come without the AI verdict')
      return null
    }
    return new Groq({ apiKey, model: process.env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL, userAgent: USER_AGENT })
  },
  none: () => null,
}

export function createAiProvider(name = process.env.AI_PROVIDER ?? 'groq'): AiProvider | null {
  const make = aiProviders[name]
  if (!make) throw new Error(`AI_PROVIDER=${name} is unknown; known: ${Object.keys(aiProviders).join(', ')}`)
  return make()
}
