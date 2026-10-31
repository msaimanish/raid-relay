import {
  ChatMessageInputSchema,
  QuestCommandSchema,
  RaidEventSchema,
  type ChatMessageInput,
  type EngineEvent,
  type QuestCommand,
} from "../../../shared/src/index.js";
import { reduceQuest } from "../engine/quest.js";
import {
  approvePendingName,
  submitNameProposal,
  submitNextNameForReview,
  vetoPendingNameAndAdvance,
} from "../naming/service.js";
import type { QuestRepository } from "../store/quest-repository.js";
import { CommandFloodLimiter } from "../twitch/command-limiter.js";
import { parseChatCommand } from "../twitch/commands.js";

export type RelayBusInput =
  | { type: "quest.command"; questId: string; command: unknown }
  | { type: "chat.message"; message: unknown }
  | { type: "raid.received"; raid: unknown }
  | { type: "name.review"; questId: string; voteDeadlineAt: number }
  | {
      type: "name.approve";
      questId: string;
      actorHash: string | null;
      voteDeadlineAt: number;
    }
  | {
      type: "name.veto";
      questId: string;
      actorHash: string | null;
      voteDeadlineAt: number;
    };

export type ChatDispatchResult =
  | {
      handled: false;
      reason:
        | "no_active_quest"
        | "malformed"
        | "rate_limited"
        | "paused"
        | "wrong_channel"
        | "wrong_phase"
        | "closed_window";
    }
  | { handled: true; action: "name"; accepted: boolean; reason?: string }
  | { handled: true; action: "join"; faction: "raider" }
  | {
      handled: true;
      action: "vote";
      round: 1 | 2;
      faction: "raider" | "local";
      choice: string;
    };

export interface RaidDispatchResult {
  duplicate: boolean;
  matched: boolean;
  questId: string | null;
  reason: "unconfigured_channel" | "no_matching_quest" | null;
  status: string | null;
  partySize: number | null;
}

export class RelayEventBus {
  private readonly channels: ReadonlySet<string>;
  private readonly limiter = new CommandFloodLimiter();

  constructor(
    private readonly repository: QuestRepository,
    configuredChannelIds: readonly string[],
  ) {
    this.channels = new Set(configuredChannelIds);
  }

  dispatch(input: RelayBusInput, now: number): unknown {
    switch (input.type) {
      case "quest.command":
        return this.dispatchQuestCommand(input.questId, input.command, now);
      case "chat.message":
        return this.dispatchChat(input.message, now);
      case "raid.received":
        return this.dispatchRaid(input.raid, now);
      case "name.review": {
        const state = this.requireQuest(input.questId);
        return submitNextNameForReview(
          this.repository,
          state,
          now,
          input.voteDeadlineAt,
        );
      }
      case "name.approve": {
        const state = this.requireQuest(input.questId);
        return approvePendingName(
          this.repository,
          state,
          input.actorHash,
          now,
          input.voteDeadlineAt,
        );
      }
      case "name.veto": {
        const state = this.requireQuest(input.questId);
        return vetoPendingNameAndAdvance(
          this.repository,
          state,
          input.actorHash,
          now,
          input.voteDeadlineAt,
        );
      }
    }
  }

  private requireQuest(questId: string) {
    const state = this.repository.get(questId);
    if (!state) throw new Error(`Quest ${questId} does not exist.`);
    return state;
  }

  private dispatchQuestCommand(
    questId: string,
    commandInput: unknown,
    now: number,
  ) {
    const command = QuestCommandSchema.parse(commandInput);
    const state = this.requireQuest(questId);
    let effectiveCommand: QuestCommand = command;
    if (command.type === "WINDOW_CLOSED") {
      const round = state.status === "BEAT1_VOTING" ? 1 : 2;
      effectiveCommand = {
        type: "WINDOW_CLOSED",
        votes: this.repository.votes(questId, round),
      };
    }
    const result = reduceQuest(state, effectiveCommand, now);
    this.repository.save(result.state, result.events);
    return result;
  }

  private dispatchChat(messageInput: unknown, now: number): ChatDispatchResult {
    const message = ChatMessageInputSchema.parse(messageInput);
    const state = this.repository.findActiveQuestByChannel(message.channelId);
    if (!state) return { handled: false, reason: "no_active_quest" };
    const round =
      state.status === "BEAT1_VOTING"
        ? 1
        : state.status === "BEAT2_VOTING"
          ? 2
          : null;
    const command = parseChatCommand(message.text, round);
    if (!command) return { handled: false, reason: "malformed" };
    if (!this.limiter.accept(message.voterHash, now))
      return { handled: false, reason: "rate_limited" };
    if (state.pausedAt !== null) return { handled: false, reason: "paused" };

    const isCurrentChannel = message.channelId === state.currentChannelId;
    const sourceChannelId = state.sourceChannelId ?? state.currentChannelId;
    const isSourceChannel = message.channelId === sourceChannelId;
    const isTargetChannel = message.channelId === state.targetChannelId;

    if (command.type === "name") {
      if (state.status !== "NAMING_OPEN" || !isCurrentChannel)
        return { handled: false, reason: "wrong_phase" };
      if (state.deadlineAt !== null && now >= state.deadlineAt)
        return { handled: false, reason: "closed_window" };
      this.repository.markSourceParticipant(
        state.id,
        message.voterHash,
        message.source,
        now,
      );
      this.recordDemoInput(state, message, "name", now);
      const result = submitNameProposal(
        this.repository,
        state,
        message.voterHash,
        command.text,
        now,
      );
      return result.accepted
        ? { handled: true, action: "name", accepted: true }
        : {
            handled: true,
            action: "name",
            accepted: false,
            reason: result.reason,
          };
    }

    if (command.type === "join") {
      const sourcePhase = [
        "DRAFT",
        "NAMING_OPEN",
        "NAME_PENDING_APPROVAL",
        "BEAT1_VOTING",
        "AWAITING_RAID",
        "HANDOFF_OFFERED",
        "WELCOME",
        "BEAT2_VOTING",
      ].includes(state.status);
      if (isSourceChannel && sourcePhase) {
        this.repository.markSourceParticipant(
          state.id,
          message.voterHash,
          message.source,
          now,
        );
        this.recordDemoInput(state, message, "join", now);
        return { handled: true, action: "join", faction: "raider" };
      }
      const targetWindowOpen =
        state.status === "WELCOME" ||
        (state.status === "BEAT2_VOTING" &&
          state.deadlineAt !== null &&
          now < state.deadlineAt);
      if (isTargetChannel && targetWindowOpen) {
        this.repository.markTargetJoin(
          state.id,
          message.voterHash,
          message.source,
          now,
        );
        this.recordDemoInput(state, message, "join", now);
        return { handled: true, action: "join", faction: "raider" };
      }
      return { handled: false, reason: "wrong_phase" };
    }

    if (command.type === "vote") {
      if (!isCurrentChannel) return { handled: false, reason: "wrong_channel" };
      if (
        (state.status !== "BEAT1_VOTING" && state.status !== "BEAT2_VOTING") ||
        round === null
      )
        return { handled: false, reason: "wrong_phase" };
      if (state.deadlineAt === null || now >= state.deadlineAt)
        return { handled: false, reason: "closed_window" };
      if (round === 1 && isSourceChannel)
        this.repository.markSourceParticipant(
          state.id,
          message.voterHash,
          message.source,
          now,
        );
      const faction = this.repository.factionForVote(
        state.id,
        message.voterHash,
      );
      this.repository.upsertVote(
        state.id,
        round,
        { voterHash: message.voterHash, faction, choice: command.choice },
        now,
        message.source,
      );
      this.recordDemoInput(state, message, "vote", now);
      return {
        handled: true,
        action: "vote",
        round,
        faction,
        choice: command.choice,
      };
    }

    return { handled: false, reason: "malformed" };
  }

  private recordDemoInput(
    state: NonNullable<ReturnType<QuestRepository["get"]>>,
    message: ChatMessageInput,
    commandType: "name" | "join" | "vote",
    now: number,
  ): void {
    if (message.source !== "demo") return;
    const event: EngineEvent = {
      type: "demo.input",
      at: now,
      data: {
        channelId: message.channelId,
        commandType,
        round:
          state.status === "BEAT1_VOTING"
            ? 1
            : state.status === "WELCOME" || state.status === "BEAT2_VOTING"
              ? 2
              : null,
        source: "demo",
      },
    };
    this.repository.save(state, [event]);
  }

  private dispatchRaid(raidInput: unknown, now: number): RaidDispatchResult {
    const raid = RaidEventSchema.parse(raidInput);
    const idempotent = this.repository.runIdempotent<RaidDispatchResult>(
      `raid:${raid.eventId}`,
      now,
      () => {
        if (
          !this.channels.has(raid.sourceChannelId) ||
          !this.channels.has(raid.targetChannelId) ||
          raid.sourceChannelId === raid.targetChannelId
        ) {
          return {
            duplicate: false,
            matched: false,
            questId: null,
            reason: "unconfigured_channel",
            status: null,
            partySize: raid.viewers,
          };
        }
        const state = this.repository.findAwaitingRaidBySource(
          raid.sourceChannelId,
        );
        if (!state) {
          return {
            duplicate: false,
            matched: false,
            questId: null,
            reason: "no_matching_quest",
            status: null,
            partySize: raid.viewers,
          };
        }
        const result = reduceQuest(
          state,
          {
            type: "RAID_RECEIVED",
            sourceChannelId: raid.sourceChannelId,
            targetChannelId: raid.targetChannelId,
            viewers: raid.viewers,
            source: raid.source,
          },
          now,
        );
        this.repository.save(result.state, result.events);
        return {
          duplicate: false,
          matched: true,
          questId: result.state.id,
          reason: null,
          status: result.state.status,
          partySize: result.state.partySize,
        };
      },
    );
    const result = idempotent.result;
    return { ...result, duplicate: idempotent.duplicate };
  }
}
