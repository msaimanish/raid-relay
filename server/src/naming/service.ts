import {
  type NameCandidate,
  type QuestState,
} from "../../../shared/src/index.js";
import { reduceQuest } from "../engine/quest.js";
import {
  moderateCandidateName,
  normalizeCandidateName,
  SAFE_DEFAULT_NAME,
} from "../moderation/name.js";
import { QuestRepository } from "../store/quest-repository.js";

export type ProposalSubmission =
  | {
      accepted: true;
      candidate: NameCandidate;
      action: "proposal_added" | "proposal_supported" | "proposal_replaced";
    }
  | {
      accepted: false;
      reason:
        | "paused"
        | "window_closed"
        | "empty"
        | "too_long"
        | "url"
        | "mention"
        | "blocked_term"
        | "invalid_characters";
    };

export function submitNameProposal(
  repository: QuestRepository,
  state: QuestState,
  voterHash: string,
  rawName: string,
  now: number,
): ProposalSubmission {
  if (state.pausedAt !== null) return { accepted: false, reason: "paused" };
  if (
    state.status !== "NAMING_OPEN" ||
    (state.deadlineAt !== null && now >= state.deadlineAt)
  ) {
    return { accepted: false, reason: "window_closed" };
  }
  const moderation = moderateCandidateName(rawName);
  if (!moderation.allowed) {
    repository.recordNameAudit(
      state.id,
      voterHash,
      "moderation_rejected",
      null,
      now,
    );
    return { accepted: false, reason: moderation.reason };
  }
  const action = repository.recordNameProposal(
    state.id,
    voterHash,
    moderation.candidate,
    now,
  );
  return { accepted: true, candidate: moderation.candidate, action };
}

export interface NameReviewSelection {
  name: string;
  normalizedName: string;
  isDefault: boolean;
  supportCount: number;
}

export function nextNameReviewSelection(
  repository: QuestRepository,
  questId: string,
): NameReviewSelection {
  const winner = repository.rankNameProposals(questId)[0];
  if (winner) {
    return {
      name: winner.displayName,
      normalizedName: winner.normalizedName,
      isDefault: false,
      supportCount: winner.supportCount,
    };
  }
  const fallback = normalizeCandidateName(SAFE_DEFAULT_NAME);
  return {
    name: fallback.displayName,
    normalizedName: fallback.normalizedName,
    isDefault: true,
    supportCount: 0,
  };
}

/** Called after the naming window closes, or to advance after a veto. */
export function submitNextNameForReview(
  repository: QuestRepository,
  state: QuestState,
  now: number,
  voteDeadlineAt: number,
) {
  if (state.status !== "NAMING_OPEN")
    throw new Error(
      "Quest must be in NAMING_OPEN to select a name for review.",
    );
  if (state.deadlineAt !== null && now < state.deadlineAt)
    throw new Error("The naming window is still open.");

  const selection = nextNameReviewSelection(repository, state.id);
  const result = selection.isDefault
    ? reduceQuest(
        state,
        { type: "USE_DEFAULT_NAME", deadlineAt: voteDeadlineAt },
        now,
      )
    : reduceQuest(
        state,
        { type: "SUBMIT_NAME_FOR_APPROVAL", name: selection.name },
        now,
      );
  if (selection.isDefault) {
    repository.saveWithNameAudit(
      result.state,
      result.events,
      null,
      "default_selected",
      selection.normalizedName,
      now,
    );
  } else {
    repository.save(result.state, result.events);
  }
  return { ...result, selection };
}

export function vetoPendingNameAndAdvance(
  repository: QuestRepository,
  state: QuestState,
  actorHash: string | null,
  now: number,
  voteDeadlineAt: number,
) {
  if (state.status !== "NAME_PENDING_APPROVAL" || state.pendingName === null)
    throw new Error("There is no pending name to veto.");
  const normalizedName = normalizeCandidateName(
    state.pendingName,
  ).normalizedName;
  const rejected = reduceQuest(state, { type: "REJECT_NAME" }, now);
  repository.saveWithNameAudit(
    rejected.state,
    rejected.events,
    actorHash,
    "vetoed",
    normalizedName,
    now,
  );
  return submitNextNameForReview(
    repository,
    rejected.state,
    now,
    voteDeadlineAt,
  );
}

export function approvePendingName(
  repository: QuestRepository,
  state: QuestState,
  actorHash: string | null,
  now: number,
  voteDeadlineAt: number,
) {
  if (state.pendingName === null)
    throw new Error("There is no pending name to approve.");
  const moderation = moderateCandidateName(state.pendingName);
  if (!moderation.allowed)
    throw new Error("Pending name did not pass moderation.");
  const result = reduceQuest(
    state,
    { type: "APPROVE_NAME", deadlineAt: voteDeadlineAt },
    now,
  );
  repository.saveWithNameAudit(
    result.state,
    result.events,
    actorHash,
    "approved",
    moderation.candidate.normalizedName,
    now,
  );
  return result;
}
