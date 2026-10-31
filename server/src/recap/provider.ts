import { z } from "zod";
import { isSafePublicText } from "../moderation/name.js";

export const RecapFactsSchema = z.object({
  questTitle: z.string().min(1).max(100),
  objective: z.string().min(1).max(240),
  sourceChannelDisplayName: z.string().min(1).max(100),
  canonName: z.string().min(1).max(64),
  beat1Decision: z.string().min(1).max(32),
  partySize: z.number().int().nonnegative().nullable(),
  partyTier: z.enum(["small", "medium", "large"]),
});
export type RecapFacts = z.infer<typeof RecapFactsSchema>;

const RecapOutputSchema = z
  .object({
    sentences: z.array(z.string()).length(2),
  })
  .strict();

export interface RecapProvider {
  generate(facts: RecapFacts): Promise<string[]>;
}

const trimSentence = (text: string): string =>
  text.trim().replace(/[.!?]+$/u, "");

export class TemplateRecapProvider implements RecapProvider {
  async generate(factsInput: RecapFacts): Promise<string[]> {
    return createTemplateRecap(factsInput);
  }
}

export function createTemplateRecap(factsInput: RecapFacts): string[] {
  const facts = RecapFactsSchema.parse(factsInput);
  const first = `Your community inherits ${trimSentence(facts.objective)}.`;
  const second = `The last group chose ${facts.beat1Decision}, and ${facts.canonName} is now part of the story.`;
  return validateRecap({ sentences: [first, second] }, facts);
}

const SENTENCE_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string" },
    },
  },
  required: ["sentences"],
  additionalProperties: false,
};

export function validateRecap(
  value: unknown,
  factsInput: RecapFacts,
): string[] {
  const facts = RecapFactsSchema.parse(factsInput);
  const parsed = RecapOutputSchema.parse(value);
  const allowedNumbers = new Set(JSON.stringify(facts).match(/\d+/gu) ?? []);
  for (const sentence of parsed.sentences) {
    const text = sentence.trim();
    if (text.length < 20 || text.length > 140)
      throw new Error("Recap sentence length is outside the allowed range.");
    if (!/[.!?]["')\]]?$/u.test(text))
      throw new Error("Recap items must each be one complete sentence.");
    const sentenceMarks = text.match(/[.!?](?=\s|$)/gu) ?? [];
    if (sentenceMarks.length !== 1)
      throw new Error("Each recap item must contain exactly one sentence.");
    if (!isSafePublicText(text))
      throw new Error("Recap contains unsafe public text.");
    const numbers = text.match(/\d+/gu) ?? [];
    if (numbers.some((number) => !allowedNumbers.has(number)))
      throw new Error("Recap contains a number that is absent from its facts.");
  }
  return parsed.sentences.map((sentence) => sentence.trim());
}

export class NemotronRecapProvider implements RecapProvider {
  private readonly endpoint: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const base = baseUrl.replace(/\/+$/u, "");
    this.endpoint = base.endsWith("/v1")
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;
  }

  async generate(factsInput: RecapFacts): Promise<string[]> {
    const facts = RecapFactsSchema.parse(factsInput);
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "Write a concise, family-friendly two-sentence story recap using only the supplied facts. Return only the requested JSON object. Do not invent numbers, URLs, usernames, or events.",
          },
          { role: "user", content: JSON.stringify(facts) },
        ],
        max_tokens: 300,
        temperature: 0.4,
        stream: false,
        chat_template_kwargs: { enable_thinking: false },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "raid_relay_recap",
            strict: true,
            schema: SENTENCE_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok)
      throw new Error(`NVIDIA recap request failed (${response.status}).`);
    const payload = z
      .object({
        choices: z
          .array(
            z.object({
              message: z
                .object({ content: z.string().nullable().optional() })
                .passthrough(),
            }),
          )
          .min(1),
      })
      .passthrough()
      .parse(await response.json());
    const content = payload.choices[0]?.message.content;
    if (!content)
      throw new Error("NVIDIA recap response did not contain content.");
    const jsonText = content
      .trim()
      .replace(/^```(?:json)?\s*/iu, "")
      .replace(/\s*```$/u, "");
    return validateRecap(JSON.parse(jsonText) as unknown, facts);
  }
}
