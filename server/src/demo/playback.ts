import { createHash, randomUUID } from "node:crypto";
import { createInitialQuestState } from "../../../shared/src/index.js";
import { RelayEventBus } from "../events/event-bus.js";
import { QuestRepository } from "../store/quest-repository.js";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function demoHash(label: string): string {
  return createHash("sha256").update(`raid-relay-demo:${label}`).digest("hex");
}

/** Plays the complete story over time so the overlay can render each live state transition. */
export async function playDemo(
  repository: QuestRepository,
  bus: RelayEventBus,
  sourceChannelId: string,
  targetChannelId: string,
  welcomeHoldSeconds: number,
  demoVoteWindowSeconds: number,
): Promise<string> {
  const questId = `demo-${randomUUID()}`;
  let now = Date.now();
  repository.save(createInitialQuestState(questId, sourceChannelId, now), [
    { type: "quest.started", at: now, data: { channelId: sourceChannelId } },
  ]);
  bus.dispatch(
    {
      type: "quest.command",
      questId,
      command: { type: "OPEN_NAMING", deadlineAt: now + 3_000 },
    },
    now,
  );

  const sendChat = (channelId: string, voter: string, text: string) =>
    bus.dispatch(
      {
        type: "chat.message",
        message: {
          channelId,
          voterHash: demoHash(voter),
          text,
          source: "demo",
        },
      },
      Date.now(),
    );

  await delay(350);
  sendChat(sourceChannelId, "name-one", "!name Ember Fox");
  sendChat(sourceChannelId, "name-two", "!name ember fox");
  await delay(3_300);
  now = Date.now();
  if (repository.get(questId)?.status === "NAMING_OPEN") {
    bus.dispatch(
      { type: "name.review", questId, voteDeadlineAt: now + 4_000 },
      now,
    );
  }
  await delay(1_250);
  now = Date.now();
  if (repository.get(questId)?.status === "NAME_PENDING_APPROVAL") {
    bus.dispatch(
      {
        type: "name.approve",
        questId,
        actorHash: null,
        voteDeadlineAt: now + 4_000,
      },
      now,
    );
  }

  await delay(300);
  sendChat(sourceChannelId, "raider-protect", "!vote protect");
  sendChat(sourceChannelId, "raider-claim", "!vote claim");
  await delay(4_100);
  now = Date.now();
  bus.dispatch(
    {
      type: "raid.received",
      raid: {
        eventId: `${questId}-raid`,
        sourceChannelId,
        targetChannelId,
        viewers: 37,
        source: "demo",
      },
    },
    now,
  );

  await delay(2_000);
  now = Date.now();
  bus.dispatch(
    { type: "quest.command", questId, command: { type: "ACCEPT_HANDOFF" } },
    now,
  );
  sendChat(targetChannelId, "incoming-joiner", "!join");
  await delay(welcomeHoldSeconds * 1_000 + 350);
  now = Date.now();
  if (repository.get(questId)?.status === "WELCOME") {
    bus.dispatch(
      {
        type: "quest.command",
        questId,
        command: {
          type: "OPEN_BEAT2_VOTING",
          deadlineAt: now + demoVoteWindowSeconds * 1_000,
        },
      },
      now,
    );
  }
  await delay(250);
  sendChat(targetChannelId, "incoming-joiner", "!vote trade");
  sendChat(targetChannelId, "local-one", "!vote fight");
  sendChat(targetChannelId, "local-two", "!vote fight");
  await delay(demoVoteWindowSeconds * 1_000 + 150);

  return questId;
}
