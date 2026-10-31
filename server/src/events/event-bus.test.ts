import { afterEach, describe, expect, it } from "vitest";
import { createInitialQuestState } from "../../../shared/src/index.js";
import { reduceQuest } from "../engine/quest.js";
import { openDatabase } from "../store/database.js";
import { QuestRepository } from "../store/quest-repository.js";
import { RelayEventBus } from "./event-bus.js";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function makeAwaitingRaid(questId = "quest-1") {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = new QuestRepository(database);
  const sourceChannelId = "channel-a";
  const targetChannelId = "channel-b";
  let state = createInitialQuestState(questId, sourceChannelId, 0);
  repository.save(state);
  const opened = reduceQuest(state, { type: "OPEN_NAMING", deadlineAt: 2 }, 1);
  state = opened.state;
  repository.save(state, opened.events);
  const named = reduceQuest(
    state,
    { type: "USE_DEFAULT_NAME", deadlineAt: 10 },
    2,
  );
  state = named.state;
  repository.save(state, named.events);
  const beat1 = reduceQuest(state, { type: "WINDOW_CLOSED", votes: [] }, 10);
  state = beat1.state;
  repository.save(state, beat1.events);
  return {
    database,
    repository,
    bus: new RelayEventBus(repository, [sourceChannelId, targetChannelId]),
    questId,
    sourceChannelId,
    targetChannelId,
    state,
  };
}

const hash = (name: string) => name.repeat(64);

describe("raid and chat event bus", () => {
  it("notifies the recap hook once for a matched raid", () => {
    const context = makeAwaitingRaid("recap-hook-q");
    const observed: Array<{ eventId: string; questId: string }> = [];
    const bus = new RelayEventBus(
      context.repository,
      [context.sourceChannelId, context.targetChannelId],
      (raid, questId) => observed.push({ eventId: raid.eventId, questId }),
    );
    const raid = {
      eventId: "recap-hook-raid",
      sourceChannelId: context.sourceChannelId,
      targetChannelId: context.targetChannelId,
      viewers: 37,
      source: "twitch" as const,
    };
    bus.dispatch({ type: "raid.received", raid }, 12);
    bus.dispatch({ type: "raid.received", raid }, 13);
    expect(observed).toEqual([
      { eventId: raid.eventId, questId: context.questId },
    ]);
  });

  it("is idempotent, preserves null raid size, and classifies source and joined participants", () => {
    const context = makeAwaitingRaid();
    context.bus.dispatch(
      {
        type: "chat.message",
        message: {
          channelId: context.sourceChannelId,
          voterHash: hash("a"),
          text: "!join",
          source: "twitch",
        },
      },
      11,
    );
    expect(context.repository.factionForVote(context.questId, hash("a"))).toBe(
      "raider",
    );
    const raid = {
      eventId: "event-null-viewers",
      sourceChannelId: context.sourceChannelId,
      targetChannelId: context.targetChannelId,
      viewers: null,
      source: "twitch" as const,
    };
    const first = context.bus.dispatch({ type: "raid.received", raid }, 12) as {
      duplicate: boolean;
      matched: boolean;
      partySize: number | null;
    };
    const replay = context.bus.dispatch(
      {
        type: "raid.received",
        raid: { ...raid, viewers: 99 },
      },
      13,
    ) as typeof first;
    expect(first).toMatchObject({
      duplicate: false,
      matched: true,
      partySize: null,
    });
    expect(replay).toMatchObject({
      duplicate: true,
      matched: true,
      partySize: null,
    });
    expect(context.repository.get(context.questId)?.partySize).toBeNull();
    expect(context.repository.get(context.questId)?.partyTier).toBe("medium");
    expect(
      context.repository
        .events(context.questId)
        .filter((event) => event.type === "raid.received"),
    ).toHaveLength(1);

    context.bus.dispatch(
      {
        type: "quest.command",
        questId: context.questId,
        command: { type: "ACCEPT_HANDOFF" },
      },
      14,
    );
    context.bus.dispatch(
      {
        type: "quest.command",
        questId: context.questId,
        command: { type: "OPEN_BEAT2_VOTING", deadlineAt: 50 },
      },
      15,
    );
    const joined = context.bus.dispatch(
      {
        type: "chat.message",
        message: {
          channelId: context.targetChannelId,
          voterHash: hash("b"),
          text: "!join",
          source: "twitch",
        },
      },
      16,
    );
    expect(joined).toMatchObject({ handled: true, action: "join" });
    const localVote = context.bus.dispatch(
      {
        type: "chat.message",
        message: {
          channelId: context.targetChannelId,
          voterHash: hash("c"),
          text: "!vote fight",
          source: "twitch",
        },
      },
      17,
    );
    const raiderVote = context.bus.dispatch(
      {
        type: "chat.message",
        message: {
          channelId: context.targetChannelId,
          voterHash: hash("b"),
          text: "!vote trade",
          source: "twitch",
        },
      },
      18,
    );
    expect(localVote).toMatchObject({ handled: true, faction: "local" });
    expect(raiderVote).toMatchObject({ handled: true, faction: "raider" });
    context.bus.dispatch(
      {
        type: "quest.command",
        questId: context.questId,
        command: { type: "WINDOW_CLOSED", votes: [] },
      },
      50,
    );
    expect(context.repository.get(context.questId)?.status).toBe("COMPLETED");
  });

  it("ignores and memoizes raids without a matching quest or configured channels", () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const repository = new QuestRepository(database);
    const bus = new RelayEventBus(repository, ["channel-a", "channel-b"]);
    const noMatchEvent = {
      eventId: "unmatched-1",
      sourceChannelId: "channel-a",
      targetChannelId: "channel-b",
      viewers: 4,
      source: "twitch",
    };
    expect(
      bus.dispatch({ type: "raid.received", raid: noMatchEvent }, 1),
    ).toMatchObject({ matched: false, reason: "no_matching_quest" });
    expect(
      bus.dispatch({ type: "raid.received", raid: noMatchEvent }, 2),
    ).toMatchObject({ duplicate: true, matched: false });
    expect(
      bus.dispatch(
        {
          type: "raid.received",
          raid: {
            ...noMatchEvent,
            eventId: "unconfigured-1",
            targetChannelId: "other-channel",
          },
        },
        3,
      ),
    ).toMatchObject({ matched: false, reason: "unconfigured_channel" });
  });

  it("records an accepted handoff dismissal without opening beat 2", () => {
    const context = makeAwaitingRaid("dismiss-q");
    context.bus.dispatch(
      {
        type: "raid.received",
        raid: {
          eventId: "dismiss-raid",
          sourceChannelId: context.sourceChannelId,
          targetChannelId: context.targetChannelId,
          viewers: 5,
          source: "demo",
        },
      },
      11,
    );
    context.bus.dispatch(
      {
        type: "quest.command",
        questId: context.questId,
        command: { type: "DISMISS_HANDOFF" },
      },
      12,
    );
    expect(context.repository.get(context.questId)?.status).toBe(
      "HANDOFF_DISMISSED",
    );
    expect(context.repository.events(context.questId).at(-1)?.type).toBe(
      "handoff.dismissed",
    );
  });
});
