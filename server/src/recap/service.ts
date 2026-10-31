import type { QuestState } from "../../../shared/src/index.js";
import type { QuestRepository } from "../store/quest-repository.js";
import {
  RecapFactsSchema,
  createTemplateRecap,
  type RecapFacts,
  type RecapProvider,
} from "./provider.js";

export interface CachedRecap {
  text: string;
  source: "ai" | "fallback";
  eventId: string | null;
}

export class RecapService {
  private readonly cacheByEventId = new Map<string, CachedRecap>();
  private readonly eventByQuestId = new Map<string, string>();

  constructor(
    private readonly repository: QuestRepository,
    private readonly aiProvider?: RecapProvider,
    private readonly onProviderError: (error: unknown) => void = () =>
      undefined,
  ) {}

  get(questId: string, state: QuestState): CachedRecap {
    const eventId = this.eventByQuestId.get(questId);
    const cached = eventId ? this.cacheByEventId.get(eventId) : undefined;
    if (cached) return cached;
    return {
      text: createTemplateRecap(this.factsFor(state)).join(" "),
      source: "fallback",
      eventId: null,
    };
  }

  onRaid(questId: string, eventId: string): void {
    if (this.cacheByEventId.has(eventId)) return;
    const state = this.repository.get(questId);
    if (!state) return;
    this.eventByQuestId.set(questId, eventId);
    const facts = this.factsFor(state);
    this.cacheByEventId.set(eventId, {
      text: createTemplateRecap(facts).join(" "),
      source: "fallback",
      eventId,
    });
    if (!this.aiProvider) return;
    void this.aiProvider.generate(facts).then(
      (aiSentences) => {
        this.cacheByEventId.set(eventId, {
          text: aiSentences.join(" "),
          source: "ai",
          eventId,
        });
      },
      (error: unknown) => this.onProviderError(error),
    );
  }

  private factsFor(state: QuestState): RecapFacts {
    return RecapFactsSchema.parse({
      questTitle: state.title,
      objective: state.objective,
      sourceChannelDisplayName:
        (state.sourceChannelId
          ? this.repository.channelDisplayName(state.sourceChannelId)
          : null) ?? "the arriving party",
      canonName: state.canonName ?? "the Ember Fox",
      beat1Decision:
        state.lastVoteResolution?.choice ??
        (state.beat1Flag === "bond" ? "protect" : "claim"),
      partySize: state.partySize,
      partyTier: state.partyTier ?? "medium",
    });
  }
}
