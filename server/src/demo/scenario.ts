import { createHash } from "node:crypto";
import { createInitialQuestState } from "../../../shared/src/index.js";
import type { RelayDatabase } from "../store/database.js";
import {
  QuestRepository,
  type StoredQuestEvent,
} from "../store/quest-repository.js";
import { RelayEventBus } from "../events/event-bus.js";

export interface DemoScenarioResult {
  questId: string;
  state: NonNullable<ReturnType<QuestRepository["get"]>>;
  events: StoredQuestEvent[];
  duplicateRaidIgnored: boolean;
}

function voterHash(name: string): string {
  return createHash("sha256").update(`raid-relay-demo:${name}`).digest("hex");
}

/** Drives a two-channel scenario through the same app event bus used by Twitch inputs. */
export function runDemoScenario(
  database: RelayDatabase,
  options: {
    questId?: string;
    sourceChannelId?: string;
    targetChannelId?: string;
    startTime?: number;
  } = {},
): DemoScenarioResult {
  const questId = options.questId ?? "demo-ember-relic";
  const sourceChannelId = options.sourceChannelId ?? "demo-channel-a";
  const targetChannelId = options.targetChannelId ?? "demo-channel-b";
  const at = (relative: number) => relative + (options.startTime ?? 0);
  const repository = new QuestRepository(database);
  if (repository.get(questId))
    throw new Error(`Demo quest ${questId} already exists in this database.`);
  repository.save(createInitialQuestState(questId, sourceChannelId, at(1_000)));
  const bus = new RelayEventBus(repository, [sourceChannelId, targetChannelId]);
  const sendChat = (
    channelId: string,
    voter: string,
    text: string,
    at: number,
  ) =>
    bus.dispatch(
      {
        type: "chat.message",
        message: {
          channelId,
          voterHash: voterHash(voter),
          text,
          source: "demo",
        },
      },
      at,
    );

  bus.dispatch(
    {
      type: "quest.command",
      questId,
      command: { type: "OPEN_NAMING", deadlineAt: at(1_045) },
    },
    at(1_000),
  );
  sendChat(sourceChannelId, "alpha", "!name Ember Fox", at(1_010));
  sendChat(sourceChannelId, "beta", "!name ember fox", at(1_011));
  bus.dispatch(
    { type: "name.review", questId, voteDeadlineAt: at(1_090) },
    at(1_045),
  );
  bus.dispatch(
    {
      type: "name.approve",
      questId,
      actorHash: null,
      voteDeadlineAt: at(1_090),
    },
    at(1_046),
  );

  sendChat(sourceChannelId, "alpha", "!vote protect", at(1_050));
  sendChat(sourceChannelId, "beta", "!vote claim", at(1_051));
  bus.dispatch(
    {
      type: "quest.command",
      questId,
      command: { type: "WINDOW_CLOSED", votes: [] },
    },
    at(1_090),
  );

  const raid = {
    eventId: `${questId}-raid-0001`,
    sourceChannelId,
    targetChannelId,
    viewers: 37,
    source: "demo" as const,
  };
  bus.dispatch({ type: "raid.received", raid }, at(1_091));
  const duplicate = bus.dispatch(
    { type: "raid.received", raid },
    at(1_092),
  ) as {
    duplicate: boolean;
  };
  bus.dispatch(
    { type: "quest.command", questId, command: { type: "ACCEPT_HANDOFF" } },
    at(1_093),
  );
  bus.dispatch(
    {
      type: "quest.command",
      questId,
      command: { type: "OPEN_BEAT2_VOTING", deadlineAt: at(1_140) },
    },
    at(1_094),
  );
  sendChat(targetChannelId, "joiner", "!join", at(1_095));
  sendChat(targetChannelId, "joiner", "!vote trade", at(1_096));
  sendChat(targetChannelId, "local-one", "!vote fight", at(1_097));
  sendChat(targetChannelId, "local-two", "!vote fight", at(1_098));
  bus.dispatch(
    {
      type: "quest.command",
      questId,
      command: { type: "WINDOW_CLOSED", votes: [] },
    },
    at(1_140),
  );

  const state = repository.get(questId);
  if (!state) throw new Error("Demo quest disappeared during its scenario.");
  return {
    questId,
    state,
    events: repository.events(questId),
    duplicateRaidIgnored: duplicate.duplicate,
  };
}
