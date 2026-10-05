import { z } from 'zod';

// JEV /v1/systemone 协议（03 §2）

export type Instr = string | Record<string, unknown> | unknown[];

export type JevQuestion =
  | { type: 'choice'; instructions: Instr; criteria: Record<string, string | Record<string, unknown> | null> }
  | { type: 'score'; instructions: Instr; criteria: Array<string | Record<string, unknown>> }
  | { type: 'noul'; instructions: Instr; criteria?: { true: string | object; false: string | object } };

export interface JevRequest {
  model: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, JevQuestion>;
}

const Probabilities = z.record(z.string(), z.number());

export const JevAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: z.number(),
    probabilities: Probabilities,
  }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    confidence: z.number(),
    probabilities: Probabilities,
    legend: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal('noul'), noul: z.number() }),
]);

export const JevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevAnswerSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).partial().default({}),
});

export type JevAnswer = z.infer<typeof JevAnswerSchema>;
export type JevResponse = z.infer<typeof JevResponseSchema>;
