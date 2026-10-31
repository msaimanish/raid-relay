import { describe, expect, it, vi } from "vitest";
import {
  NemotronRecapProvider,
  createTemplateRecap,
  validateRecap,
  type RecapFacts,
} from "./provider.js";

const facts: RecapFacts = {
  questTitle: "The Ember Relic",
  objective: "Carry the Ember Relic to the end of the road.",
  sourceChannelDisplayName: "ember_crew",
  canonName: "the Ember Fox",
  beat1Decision: "protect",
  partySize: 37,
  partyTier: "medium",
};

const validOutput = {
  sentences: [
    "The ember crew arrives to carry the relic toward the road's end.",
    "The last group chose protect, and the Ember Fox joins their story.",
  ],
};

function jsonResponse(status: number, content?: string): Response {
  return new Response(
    JSON.stringify(
      content === undefined
        ? { error: { message: "request failed" } }
        : { choices: [{ message: { content } }] },
    ),
    { status, headers: { "content-type": "application/json" } },
  );
}

describe("recap providers", () => {
  it("builds a deterministic two-sentence template from facts", () => {
    expect(createTemplateRecap(facts)).toEqual([
      "Your community inherits Carry the Ember Relic to the end of the road.",
      "The last group chose protect, and the Ember Fox is now part of the story.",
    ]);
  });

  it("validates exact sentence count, safety, and fact-grounded numbers", () => {
    expect(() =>
      validateRecap({ sentences: ["Only one sentence is here."] }, facts),
    ).toThrow();
    expect(() =>
      validateRecap(
        {
          sentences: [
            "A safe sentence is long enough to pass.",
            "This adds 99 viewers to the story.",
          ],
        },
        facts,
      ),
    ).toThrow(/number/);
    expect(() =>
      validateRecap(
        {
          sentences: [
            "Visit https://example.com for the story.",
            "The last choice carries the Ember Fox onward.",
          ],
        },
        facts,
      ),
    ).toThrow(/unsafe/);
    expect(() =>
      validateRecap(
        {
          sentences: [
            "A viewer named @someone guides the party onward.",
            "The last choice carries the Ember Fox onward.",
          ],
        },
        facts,
      ),
    ).toThrow(/unsafe/);
    expect(validateRecap(validOutput, facts)).toHaveLength(2);
  });

  it("uses NVIDIA's documented endpoint and structured output with thinking disabled", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(200, JSON.stringify(validOutput)),
    ) as unknown as typeof fetch;
    const provider = new NemotronRecapProvider(
      "test-key",
      "https://integrate.api.nvidia.com/v1/",
      "nvidia/nemotron-3.5-bolt-e4b",
      8000,
      fetcher,
    );
    await expect(provider.generate(facts)).resolves.toEqual(
      validOutput.sentences,
    );
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(request.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(request.response_format).toMatchObject({ type: "json_schema" });
    expect(request.messages).not.toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("voter") }),
    );
  });

  it.each([
    ["malformed JSON", "not json"],
    [
      "extra ungrounded number",
      JSON.stringify({
        sentences: [
          "The group arrives with 99 banners on the road.",
          "The last choice carries the Ember Fox onward.",
        ],
      }),
    ],
    [
      "URL",
      JSON.stringify({
        sentences: [
          "Visit https://example.com for the tale.",
          "The last choice carries the Ember Fox onward.",
        ],
      }),
    ],
  ])("rejects %s model output", async (_label, content) => {
    const provider = new NemotronRecapProvider(
      "test-key",
      "https://nvidia.test/v1",
      "test-model",
      100,
      vi.fn(async () =>
        jsonResponse(200, String(content)),
      ) as unknown as typeof fetch,
    );
    await expect(provider.generate(facts)).rejects.toThrow();
  });

  it.each([429, 500])(
    "rejects NVIDIA HTTP %s for fallback handling",
    async (status) => {
      const provider = new NemotronRecapProvider(
        "test-key",
        "https://nvidia.test/v1",
        "test-model",
        100,
        vi.fn(async () => jsonResponse(status)) as unknown as typeof fetch,
      );
      await expect(provider.generate(facts)).rejects.toThrow(`(${status})`);
    },
  );

  it("ignores separate reasoning content and enforces request timeout", async () => {
    const reasoningFetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  reasoning_content: "invented 99",
                  content: JSON.stringify(validOutput),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const reasoningProvider = new NemotronRecapProvider(
      "key",
      "https://nvidia.test/v1",
      "model",
      100,
      reasoningFetcher,
    );
    await expect(reasoningProvider.generate(facts)).resolves.toEqual(
      validOutput.sentences,
    );

    const timeoutFetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    ) as unknown as typeof fetch;
    const timeoutProvider = new NemotronRecapProvider(
      "key",
      "https://nvidia.test/v1",
      "model",
      1,
      timeoutFetcher,
    );
    await expect(timeoutProvider.generate(facts)).rejects.toThrow();
  });
});
