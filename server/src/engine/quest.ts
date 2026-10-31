import {
  QuestCommandSchema,
  QuestStateSchema,
  type EngineEvent,
  type EngineResult,
  type QuestCommand,
  type QuestState,
  type PartyTier,
} from "../../../shared/src/index.js";
import { calculateOutcome, BEAT2_CHOICES } from "./outcomes.js";
import { resolveVotes } from "./voting.js";

export class InvalidQuestCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQuestCommandError";
  }
}

export function derivePartyTier(viewers: number | null): PartyTier {
  if (viewers === null) return "medium";
  if (!Number.isSafeInteger(viewers) || viewers < 0)
    throw new RangeError(
      "Raid viewer count must be a non-negative safe integer or null.",
    );
  if (viewers < 10) return "small";
  if (viewers < 50) return "medium";
  return "large";
}

function requireStatus(
  state: QuestState,
  expected: QuestState["status"],
): void {
  if (state.status !== expected)
    throw new InvalidQuestCommandError(
      `Command requires ${expected}; quest is ${state.status}.`,
    );
}

/** Pure reducer: no I/O or timers; the caller supplies the event time. */
export function reduceQuest(
  stateInput: QuestState,
  commandInput: QuestCommand,
  now: number,
): EngineResult {
  const state = QuestStateSchema.parse(stateInput);
  const command = QuestCommandSchema.parse(commandInput);
  if (!Number.isSafeInteger(now))
    throw new RangeError("Engine time must be an integer timestamp.");
  if (
    state.pausedAt !== null &&
    command.type !== "RESUME" &&
    command.type !== "PAUSE"
  ) {
    throw new InvalidQuestCommandError(
      "Quest is paused; resume it before accepting commands.",
    );
  }

  const next: QuestState = {
    ...state,
    revision: state.revision + 1,
    updatedAt: now,
  };
  const events: EngineEvent[] = [];
  const emit = (type: string, data: Record<string, unknown> = {}): void => {
    events.push({ type, at: now, data });
  };

  switch (command.type) {
    case "OPEN_NAMING":
      requireStatus(state, "DRAFT");
      if (command.deadlineAt <= now)
        throw new InvalidQuestCommandError(
          "Naming deadline must be in the future.",
        );
      next.status = "NAMING_OPEN";
      next.deadlineAt = command.deadlineAt;
      emit("naming.opened", { deadlineAt: command.deadlineAt });
      break;
    case "SUBMIT_NAME_FOR_APPROVAL":
      requireStatus(state, "NAMING_OPEN");
      if (state.deadlineAt !== null && now >= state.deadlineAt)
        throw new InvalidQuestCommandError("Naming window is closed.");
      next.status = "NAME_PENDING_APPROVAL";
      next.pendingName = command.name;
      next.deadlineAt = null;
      // Candidate text is private until streamer approval; never put it in chain history.
      emit("name.pending_approval");
      break;
    case "APPROVE_NAME":
      requireStatus(state, "NAME_PENDING_APPROVAL");
      if (!state.pendingName)
        throw new InvalidQuestCommandError(
          "There is no pending name to approve.",
        );
      if (command.deadlineAt <= now)
        throw new InvalidQuestCommandError(
          "Voting deadline must be in the future.",
        );
      next.canonName = state.pendingName;
      next.pendingName = null;
      next.status = "BEAT1_VOTING";
      next.deadlineAt = command.deadlineAt;
      emit("name.approved", { canonName: next.canonName });
      emit("beat1.voting_opened", { deadlineAt: command.deadlineAt });
      break;
    case "REJECT_NAME":
      requireStatus(state, "NAME_PENDING_APPROVAL");
      next.pendingName = null;
      next.status = "NAMING_OPEN";
      emit("name.rejected");
      break;
    case "WINDOW_CLOSED":
      if (state.status !== "BEAT1_VOTING" && state.status !== "BEAT2_VOTING") {
        throw new InvalidQuestCommandError("No vote window is open.");
      }
      if (state.deadlineAt === null || now < state.deadlineAt)
        throw new InvalidQuestCommandError(
          "Vote window deadline has not passed.",
        );
      next.deadlineAt = null;
      if (state.status === "BEAT1_VOTING") {
        const resolution = resolveVotes(
          command.votes,
          ["protect", "claim"],
          "protect",
        );
        next.lastVoteResolution = resolution;
        next.beat1Flag = resolution.choice === "protect" ? "bond" : "power";
        next.status = "AWAITING_RAID";
        emit("beat1.resolved", { resolution, flag: next.beat1Flag });
      } else {
        if (!state.beat1Flag || !state.partyTier)
          throw new InvalidQuestCommandError(
            "Beat 1 flag and raid tier are required to resolve beat 2.",
          );
        const resolution = resolveVotes(command.votes, BEAT2_CHOICES, "sneak");
        const outcome = calculateOutcome(
          resolution.choice as (typeof BEAT2_CHOICES)[number],
          state.partyTier,
          state.beat1Flag,
        );
        next.lastVoteResolution = resolution;
        next.outcome = outcome;
        next.status = "COMPLETED";
        emit("beat2.resolved", { resolution, outcome });
      }
      break;
    case "RAID_RECEIVED":
      requireStatus(state, "AWAITING_RAID");
      if (command.sourceChannelId === command.targetChannelId)
        throw new InvalidQuestCommandError(
          "Raid source and target must differ.",
        );
      next.sourceChannelId = command.sourceChannelId;
      next.targetChannelId = command.targetChannelId;
      next.currentChannelId = command.targetChannelId;
      next.partySize = command.viewers;
      next.partyTier = derivePartyTier(command.viewers);
      next.status = "HANDOFF_OFFERED";
      emit("raid.received", {
        sourceChannelId: command.sourceChannelId,
        targetChannelId: command.targetChannelId,
        viewers: command.viewers,
        partyTier: next.partyTier,
        fallback:
          command.viewers === null ? "missing viewers; medium tier used" : null,
      });
      break;
    case "ACCEPT_HANDOFF":
      requireStatus(state, "HANDOFF_OFFERED");
      next.status = "WELCOME";
      emit("handoff.accepted", {
        sourceChannelId: state.sourceChannelId,
        targetChannelId: state.targetChannelId,
      });
      break;
    case "DISMISS_HANDOFF":
      requireStatus(state, "HANDOFF_OFFERED");
      next.status = "HANDOFF_DISMISSED";
      emit("handoff.dismissed", {
        sourceChannelId: state.sourceChannelId,
        targetChannelId: state.targetChannelId,
      });
      break;
    case "OPEN_BEAT2_VOTING":
      requireStatus(state, "WELCOME");
      if (command.deadlineAt <= now)
        throw new InvalidQuestCommandError(
          "Voting deadline must be in the future.",
        );
      next.status = "BEAT2_VOTING";
      next.deadlineAt = command.deadlineAt;
      emit("beat2.voting_opened", { deadlineAt: command.deadlineAt });
      break;
    case "PAUSE":
      if (state.pausedAt !== null)
        throw new InvalidQuestCommandError("Quest is already paused.");
      next.pausedAt = now;
      emit("quest.paused", { pausedAt: now });
      break;
    case "RESUME": {
      if (state.pausedAt === null)
        throw new InvalidQuestCommandError("Quest is not paused.");
      if (now < state.pausedAt)
        throw new InvalidQuestCommandError(
          "Resume time cannot be earlier than the pause time.",
        );
      const pauseDuration = Math.max(0, now - state.pausedAt);
      next.pausedAt = null;
      if (state.deadlineAt !== null)
        next.deadlineAt = state.deadlineAt + pauseDuration;
      emit("quest.resumed", { pauseDuration, deadlineAt: next.deadlineAt });
      break;
    }
  }

  return { state: QuestStateSchema.parse(next), events, effects: [] };
}
