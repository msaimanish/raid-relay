import { describe, expect, it } from "vitest";
import { createInitialQuestState } from "../../../shared/src/index.js";
import {
  reduceQuest,
  derivePartyTier,
  InvalidQuestCommandError,
} from "./quest.js";
import { BEAT2_CHOICES, calculateOutcome } from "./outcomes.js";
import { resolveVotes } from "./voting.js";

const vote = (
  key: string,
  faction: "raider" | "local",
  choice: "protect" | "claim" | "fight" | "trade" | "sneak",
) => ({ voterHash: key.repeat(64), faction, choice });

function move(
  state: ReturnType<typeof createInitialQuestState>,
  command: Parameters<typeof reduceQuest>[1],
  now: number,
) {
  return reduceQuest(state, command, now).state;
}

function toBeat1(state = createInitialQuestState("q1", "source", 0)) {
  let s = move(state, { type: "OPEN_NAMING", deadlineAt: 100 }, 1);
  s = move(s, { type: "SUBMIT_NAME_FOR_APPROVAL", name: "Ember Fox" }, 100);
  return move(s, { type: "APPROVE_NAME", deadlineAt: 200 }, 101);
}

describe("quest reducer", () => {
  it("accepts every happy-path transition and emits deterministic events", () => {
    let state = createInitialQuestState("q1", "source", 0);
    state = move(state, { type: "OPEN_NAMING", deadlineAt: 10 }, 1);
    expect(state.status).toBe("NAMING_OPEN");
    state = move(
      state,
      { type: "SUBMIT_NAME_FOR_APPROVAL", name: "The Ember Fox" },
      10,
    );
    expect(state.status).toBe("NAME_PENDING_APPROVAL");
    state = move(state, { type: "APPROVE_NAME", deadlineAt: 20 }, 11);
    expect(state.canonName).toBe("The Ember Fox");
    const beat1 = reduceQuest(
      state,
      { type: "WINDOW_CLOSED", votes: [vote("a", "raider", "claim")] },
      20,
    );
    expect(beat1.state.status).toBe("AWAITING_RAID");
    expect(beat1.state.beat1Flag).toBe("power");
    expect(beat1.events[0]?.type).toBe("beat1.resolved");
    state = reduceQuest(
      beat1.state,
      {
        type: "RAID_RECEIVED",
        sourceChannelId: "source",
        targetChannelId: "target",
        viewers: 50,
      },
      21,
    ).state;
    expect(state.partySize).toBe(50);
    expect(state.partyTier).toBe("large");
    state = move(state, { type: "ACCEPT_HANDOFF" }, 22);
    state = move(state, { type: "OPEN_BEAT2_VOTING", deadlineAt: 30 }, 23);
    const beat2 = reduceQuest(
      state,
      { type: "WINDOW_CLOSED", votes: [vote("b", "local", "fight")] },
      30,
    );
    expect(beat2.state.status).toBe("COMPLETED");
    expect(beat2.state.outcome?.choice).toBe("fight");
    expect(beat2.events[0]?.type).toBe("beat2.resolved");
  });

  it("supports rejecting a name and dismissing a handoff", () => {
    let state = createInitialQuestState("q2", "source", 0);
    state = move(state, { type: "OPEN_NAMING", deadlineAt: 100 }, 1);
    state = move(
      state,
      { type: "SUBMIT_NAME_FOR_APPROVAL", name: "Candidate" },
      100,
    );
    state = move(state, { type: "REJECT_NAME" }, 101);
    expect(state.status).toBe("NAMING_OPEN");
    state = move(
      state,
      { type: "SUBMIT_NAME_FOR_APPROVAL", name: "Approved" },
      102,
    );
    state = move(state, { type: "APPROVE_NAME", deadlineAt: 110 }, 103);
    state = move(state, { type: "WINDOW_CLOSED", votes: [] }, 110);
    state = move(
      state,
      {
        type: "RAID_RECEIVED",
        sourceChannelId: "source",
        targetChannelId: "target",
        viewers: 1,
      },
      111,
    );
    expect(move(state, { type: "DISMISS_HANDOFF" }, 112).status).toBe(
      "HANDOFF_DISMISSED",
    );
  });

  it("rejects invalid transitions and early window closes", () => {
    const state = createInitialQuestState("q", "channel", 0);
    expect(() =>
      reduceQuest(state, { type: "SUBMIT_NAME_FOR_APPROVAL", name: "x" }, 1),
    ).toThrow(InvalidQuestCommandError);
    const voting = toBeat1();
    expect(() =>
      reduceQuest(voting, { type: "WINDOW_CLOSED", votes: [] }, 199),
    ).toThrow(/deadline has not passed/);
  });

  it("keeps unapproved name text out of chain events", () => {
    let state = move(
      createInitialQuestState("q", "channel", 0),
      { type: "OPEN_NAMING", deadlineAt: 100 },
      1,
    );
    const submission = reduceQuest(
      state,
      { type: "SUBMIT_NAME_FOR_APPROVAL", name: "Private proposal" },
      100,
    );
    state = submission.state;
    expect(state.pendingName).toBe("Private proposal");
    expect(JSON.stringify(submission.events)).not.toContain("Private proposal");
    const rejection = reduceQuest(state, { type: "REJECT_NAME" }, 101);
    expect(JSON.stringify(rejection.events)).not.toContain("Private proposal");
  });

  it("uses a pure fallback for missing raid size and retains raw values", () => {
    expect([
      derivePartyTier(9),
      derivePartyTier(10),
      derivePartyTier(49),
      derivePartyTier(50),
      derivePartyTier(null),
    ]).toEqual(["small", "medium", "medium", "large", "medium"]);
    const result = reduceQuest(
      move(toBeat1(), { type: "WINDOW_CLOSED", votes: [] }, 200),
      {
        type: "RAID_RECEIVED",
        sourceChannelId: "a",
        targetChannelId: "b",
        viewers: null,
      },
      201,
    );
    expect(result.state.partySize).toBeNull();
    expect(result.events[0]?.data.fallback).toContain("medium");
  });

  it("freezes a deadline while paused and shifts it by the pause duration on resume", () => {
    let state = move(
      createInitialQuestState("q", "channel", 0),
      { type: "OPEN_NAMING", deadlineAt: 120 },
      100,
    );
    state = move(state, { type: "PAUSE" }, 110);
    expect(state.deadlineAt).toBe(120);
    expect(() =>
      reduceQuest(state, { type: "SUBMIT_NAME_FOR_APPROVAL", name: "x" }, 115),
    ).toThrow(/paused/);
    state = move(state, { type: "RESUME" }, 160);
    expect(state.deadlineAt).toBe(170);
  });
});

describe("vote aggregation", () => {
  it("combines faction shares equally and breaks equal shares by raw vote count", () => {
    const result = resolveVotes(
      [
        vote("a", "raider", "protect"),
        vote("b", "raider", "protect"),
        vote("c", "raider", "protect"),
        vote("d", "local", "claim"),
      ],
      ["protect", "claim"],
      "protect",
    );
    expect(result.choice).toBe("protect");
    expect(result.shares.protect?.score).toBe(0.5);
    expect(result.shares.claim?.score).toBe(0.5);
    expect(result.raw.protect?.raider).toBe(3);
    expect(result.totals).toEqual({ raider: 3, local: 1 });
  });

  it("uses only the voting faction share when the other faction abstains", () => {
    const result = resolveVotes(
      [
        vote("a", "local", "trade"),
        vote("b", "local", "trade"),
        vote("c", "local", "fight"),
      ],
      BEAT2_CHOICES,
      "sneak",
    );
    expect(result.choice).toBe("trade");
    expect(result.shares.trade?.score).toBe(2 / 3);
    expect(result.shares.fight?.score).toBe(1 / 3);
    expect(result.totals).toEqual({ raider: 0, local: 3 });
  });

  it("selects the designated default for zero votes and records no_votes", () => {
    const result = resolveVotes([], BEAT2_CHOICES, "sneak");
    expect(result.choice).toBe("sneak");
    expect(result.noVotes).toBe(true);
  });

  it("deduplicates by hashed account with the latest choice and uses fixed choice order on a full tie", () => {
    const replaced = resolveVotes(
      [vote("a", "raider", "fight"), vote("a", "raider", "trade")],
      BEAT2_CHOICES,
      "sneak",
    );
    expect(replaced.totals.raider).toBe(1);
    expect(replaced.raw.trade?.raider).toBe(1);
    const tie = resolveVotes(
      [vote("a", "local", "fight"), vote("b", "local", "trade")],
      BEAT2_CHOICES,
      "sneak",
    );
    expect(tie.choice).toBe("fight");
  });
});

describe("outcomes", () => {
  it("calculates all 3 choices × 3 tiers × 2 flags with deterministic templates", () => {
    const expectedScores = {
      small: {
        bond: { fight: 2, trade: 4, sneak: 5 },
        power: { fight: 3, trade: 3, sneak: 4 },
      },
      medium: {
        bond: { fight: 3, trade: 4, sneak: 4 },
        power: { fight: 4, trade: 3, sneak: 3 },
      },
      large: {
        bond: { fight: 4, trade: 4, sneak: 3 },
        power: { fight: 5, trade: 3, sneak: 2 },
      },
    } as const;
    for (const choice of BEAT2_CHOICES) {
      for (const tier of ["small", "medium", "large"] as const) {
        for (const flag of ["bond", "power"] as const) {
          const first = calculateOutcome(choice, tier, flag);
          expect(calculateOutcome(choice, tier, flag)).toEqual(first);
          const expectedScore = expectedScores[tier][flag][choice];
          expect(first.score).toBe(expectedScore);
          expect(first.kind).toBe(
            expectedScore >= 4
              ? "triumph"
              : expectedScore === 3
                ? "costly_win"
                : "setback",
          );
          expect(first.text.length).toBeGreaterThan(10);
          expect(first.stateDelta).toEqual({
            relic:
              choice === "trade"
                ? "traded"
                : expectedScore <= 2
                  ? "lost"
                  : "kept",
            bond: flag === "bond" ? 1 : 0,
          });
        }
      }
    }
  });

  it("replays a fixed command sequence byte-for-byte deterministically", () => {
    const replay = (): string => {
      let state = createInitialQuestState("deterministic-q", "source", 0);
      const allEvents: ReturnType<typeof reduceQuest>["events"] = [];
      const commands: Array<[Parameters<typeof reduceQuest>[1], number]> = [
        [{ type: "OPEN_NAMING", deadlineAt: 100 }, 1],
        [{ type: "SUBMIT_NAME_FOR_APPROVAL", name: "Ember Fox" }, 100],
        [{ type: "APPROVE_NAME", deadlineAt: 200 }, 101],
        [
          { type: "WINDOW_CLOSED", votes: [vote("a", "raider", "protect")] },
          200,
        ],
        [
          {
            type: "RAID_RECEIVED",
            sourceChannelId: "source",
            targetChannelId: "target",
            viewers: 12,
          },
          201,
        ],
        [{ type: "ACCEPT_HANDOFF" }, 202],
        [{ type: "OPEN_BEAT2_VOTING", deadlineAt: 300 }, 203],
        [{ type: "WINDOW_CLOSED", votes: [vote("b", "local", "trade")] }, 300],
      ];
      for (const [command, now] of commands) {
        const result = reduceQuest(state, command, now);
        state = result.state;
        allEvents.push(...result.events);
      }
      return JSON.stringify({ state, events: allEvents });
    };
    expect(replay()).toBe(replay());
  });
});
