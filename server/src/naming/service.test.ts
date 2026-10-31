import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialQuestState } from "../../../shared/src/index.js";
import { reduceQuest } from "../engine/quest.js";
import { openDatabase } from "../store/database.js";
import { QuestRepository } from "../store/quest-repository.js";
import {
  approvePendingName,
  nextNameReviewSelection,
  submitNameProposal,
  submitNextNameForReview,
  vetoPendingNameAndAdvance,
} from "./service.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function namingFixture(id = "naming-q") {
  const directory = mkdtempSync(join(tmpdir(), "raid-relay-naming-"));
  directories.push(directory);
  const database = openDatabase(join(directory, "naming.sqlite"));
  const repository = new QuestRepository(database);
  const draft = createInitialQuestState(id, "source", 0);
  const opened = reduceQuest(
    draft,
    { type: "OPEN_NAMING", deadlineAt: 100 },
    1,
  );
  repository.save(opened.state, opened.events);
  return { database, repository, state: opened.state };
}

const hash = (char: string) => char.repeat(64);

describe("name proposal service", () => {
  it("moderates proposals and lets one account replace its backed name", () => {
    const { database, repository, state } = namingFixture();
    expect(
      submitNameProposal(
        repository,
        state,
        hash("a"),
        "Ｅｍｂｅｒ\u200b Fox",
        10,
      ),
    ).toMatchObject({ accepted: true, action: "proposal_added" });
    expect(
      submitNameProposal(repository, state, hash("b"), "ember fox", 11),
    ).toMatchObject({ accepted: true, action: "proposal_added" });
    expect(
      submitNameProposal(repository, state, hash("a"), "Glimmer", 12),
    ).toMatchObject({ accepted: true, action: "proposal_replaced" });
    expect(
      submitNameProposal(repository, state, hash("a"), "GLIMMER", 13),
    ).toMatchObject({ accepted: true, action: "proposal_supported" });
    expect(repository.rankNameProposals(state.id)).toEqual([
      {
        displayName: "ember fox",
        normalizedName: "ember fox",
        supportCount: 1,
        firstProposedAt: 11,
      },
      {
        displayName: "Glimmer",
        normalizedName: "glimmer",
        supportCount: 1,
        firstProposedAt: 12,
      },
    ]);
    expect(
      submitNameProposal(
        repository,
        state,
        hash("c"),
        "https://bad.example",
        14,
      ),
    ).toEqual({ accepted: false, reason: "url" });
    const audits = database
      .prepare("SELECT action FROM name_audit WHERE quest_id = ? ORDER BY id")
      .all(state.id) as Array<{ action: string }>;
    expect(audits.map((entry) => entry.action)).toEqual([
      "proposal_added",
      "proposal_added",
      "proposal_replaced",
      "proposal_supported",
      "moderation_rejected",
    ]);
    database.close();
  });

  it("ranks by plurality, then by earliest first proposal", () => {
    const { database, repository, state } = namingFixture();
    submitNameProposal(repository, state, hash("a"), "Amber", 10);
    submitNameProposal(repository, state, hash("b"), "Birch", 11);
    expect(repository.rankNameProposals(state.id)[0]?.displayName).toBe(
      "Amber",
    );
    submitNameProposal(repository, state, hash("c"), "Birch", 12);
    expect(repository.rankNameProposals(state.id)[0]).toMatchObject({
      displayName: "Birch",
      supportCount: 2,
      firstProposedAt: 11,
    });
    database.close();
  });

  it("does not accept proposals while the quest is paused", () => {
    const { database, repository, state } = namingFixture();
    const paused = reduceQuest(state, { type: "PAUSE" }, 10).state;
    expect(
      submitNameProposal(repository, paused, hash("a"), "Ember Fox", 11),
    ).toEqual({ accepted: false, reason: "paused" });
    expect(repository.rankNameProposals(state.id)).toEqual([]);
    database.close();
  });

  it("vetoes ranked candidates in order and selects the safe default after all are vetoed", () => {
    const { database, repository, state } = namingFixture();
    submitNameProposal(repository, state, hash("a"), "Foxglove", 10);
    submitNameProposal(repository, state, hash("b"), "Foxglove", 11);
    submitNameProposal(repository, state, hash("c"), "Mosslight", 12);

    const first = submitNextNameForReview(repository, state, 100, 200);
    expect(first.state.pendingName).toBe("Foxglove");
    const second = vetoPendingNameAndAdvance(
      repository,
      first.state,
      hash("d"),
      101,
      200,
    );
    expect(second.state.pendingName).toBe("Mosslight");
    const fallback = vetoPendingNameAndAdvance(
      repository,
      second.state,
      hash("d"),
      102,
      200,
    );
    expect(fallback.state.status).toBe("BEAT1_VOTING");
    expect(fallback.state.canonName).toBe("the Ember Fox");
    expect(fallback.selection.isDefault).toBe(true);
    expect(repository.rankNameProposals(state.id)).toEqual([]);
    const history = JSON.stringify(repository.events(state.id));
    expect(history).not.toContain("Foxglove");
    expect(history).not.toContain("Mosslight");
    expect(history).toContain("the Ember Fox");
    const vetoCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM name_audit WHERE quest_id = ? AND action = 'vetoed'",
      )
      .get(state.id) as { count: number };
    expect(vetoCount.count).toBe(2);
    database.close();
  });

  it("uses the default when no proposal survives and exposes chat proposals only after approval", () => {
    const empty = namingFixture("empty-names");
    submitNameProposal(empty.repository, empty.state, hash("a"), "@unsafe", 10);
    expect(
      nextNameReviewSelection(empty.repository, empty.state.id).isDefault,
    ).toBe(true);
    const fallback = submitNextNameForReview(
      empty.repository,
      empty.state,
      100,
      200,
    );
    expect(fallback.state.canonName).toBe("the Ember Fox");
    empty.database.close();

    const approved = namingFixture("approved-names");
    submitNameProposal(
      approved.repository,
      approved.state,
      hash("b"),
      "Ember Lark",
      10,
    );
    const pending = submitNextNameForReview(
      approved.repository,
      approved.state,
      100,
      200,
    );
    expect(pending.state.canonName).toBeNull();
    expect(pending.state.pendingName).toBe("Ember Lark");
    const result = approvePendingName(
      approved.repository,
      pending.state,
      null,
      101,
      201,
    );
    expect(result.state.canonName).toBe("Ember Lark");
    expect(approved.repository.events(approved.state.id).at(-2)?.type).toBe(
      "name.approved",
    );
    approved.database.close();
  });
});
