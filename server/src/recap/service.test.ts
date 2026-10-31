import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialQuestState } from "../../../shared/src/index.js";
import { openDatabase } from "../store/database.js";
import { QuestRepository } from "../store/quest-repository.js";
import { RecapService } from "./service.js";
import type { RecapProvider } from "./provider.js";

const aiSentences = [
  "The ember crew arrives to carry the relic toward the road's end.",
  "The last group chose protect, and the Ember Fox joins their story.",
];

describe("RecapService", () => {
  let database: ReturnType<typeof openDatabase> | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
  });

  function createService(provider?: RecapProvider) {
    database = openDatabase(":memory:");
    const repository = new QuestRepository(database);
    const initial = createInitialQuestState("recap-q", "source", 1);
    repository.save({
      ...initial,
      status: "HANDOFF_OFFERED",
      sourceChannelId: "source",
      targetChannelId: "target",
      partySize: 37,
      partyTier: "medium",
      canonName: "the Ember Fox",
      beat1Flag: "bond",
      lastVoteResolution: {
        choice: "protect",
        ruleVersion: "v1-equal-faction-share",
        noVotes: false,
        raw: {
          protect: { raider: 1, local: 0 },
          claim: { raider: 0, local: 0 },
        },
        shares: {
          protect: { raider: 1, local: 0, score: 1 },
          claim: { raider: 0, local: 0, score: 0 },
        },
        totals: { raider: 1, local: 0 },
      },
    });
    return { repository, service: new RecapService(repository, provider) };
  }

  it("shows the template immediately, caches by raid event, and updates from AI", async () => {
    let resolveAi!: (sentences: string[]) => void;
    const provider: RecapProvider = {
      generate: vi.fn(
        () =>
          new Promise<string[]>((resolve) => {
            resolveAi = resolve;
          }),
      ),
    };
    const { service } = createService(provider);
    const before = service.get(
      "recap-q",
      createInitialQuestState("fallback", "s", 1),
    );
    expect(before.source).toBe("fallback");
    service.onRaid("recap-q", "raid-event-1");
    expect(
      service.get("recap-q", createInitialQuestState("fallback", "s", 1)),
    ).toMatchObject({
      source: "fallback",
      eventId: "raid-event-1",
    });
    service.onRaid("recap-q", "raid-event-1");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    resolveAi(aiSentences);
    await vi.waitFor(() =>
      expect(
        service.get("recap-q", createInitialQuestState("fallback", "s", 1)),
      ).toMatchObject({
        text: aiSentences.join(" "),
        source: "ai",
      }),
    );
  });

  it("keeps the safe fallback when the AI provider fails", () => {
    const provider: RecapProvider = {
      generate: vi.fn().mockRejectedValue(new Error("offline")),
    };
    const { repository, service } = createService(provider);
    service.onRaid("recap-q", "raid-event-2");
    const state = repository.get("recap-q");
    if (!state) throw new Error("Recap test quest missing.");
    expect(service.get("recap-q", state)).toMatchObject({ source: "fallback" });
  });
});
