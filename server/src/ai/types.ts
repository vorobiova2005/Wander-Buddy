/**
 * The AI verdict: its JSON schema (the contract the diploma's answer checking will build on) and the interface of
 * an AI source. Same rule as transit/ and enrichment/: the rest of the server knows only these; the source is
 * swapped with AI_PROVIDER (ai/index.ts), the model with GROQ_MODEL.
 */
import { z } from 'zod'

const id = z.string().min(1).max(80)
const text = (max: number) => z.string().trim().min(1).max(max)

export const VerdictSchema = z.object({
  /** The best destinations, best first - ids from the candidates only. */
  top: z
    .array(z.object({ id, reason: text(300) }))
    .min(1)
    .max(3),
  /** How the top destinations differ, in one or two sentences. */
  comparison: text(600),
  /** Things to watch out for: weather, long trip, transfers, the way back. */
  warnings: z.array(z.object({ id: id.optional(), text: text(300) })).max(5),
  /** A plan for the day in the first destination, as a quest. */
  quest: z.object({
    cityId: id,
    title: text(80),
    steps: z
      .array(
        z.object({
          /** Local time, HH:MM. */
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          title: text(80),
          /** A place id from that city's places, when the step is at one of them. */
          placeId: id.optional(),
          description: text(300),
          /** Experience points for completing the step. */
          xp: z.number().int().min(5).max(100),
        }),
      )
      .min(3)
      .max(8),
  }),
  /** What the companion character says. */
  character: z.object({
    mood: z.enum(['happy', 'excited', 'thoughtful', 'worried']),
    line: text(240),
  }),
})

export type Verdict = z.infer<typeof VerdictSchema>

/** The JSON Schema of the verdict, given to the model so it knows the exact shape. */
export const VERDICT_JSON_SCHEMA = z.toJSONSchema(VerdictSchema)

export type ChatMessage = { role: 'system' | 'user'; content: string }

export interface AiProvider {
  readonly name: string
  readonly model: string
  /** Asks for a JSON answer; returns the raw text. Validation is not the provider's job. `signal` ends the wait early. */
  completeJson(messages: ChatMessage[], signal?: AbortSignal): Promise<string>
}
