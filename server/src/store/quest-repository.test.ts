import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialQuestState } from "../../../shared/src/index.js";
import { reduceQuest } from "../engine/quest.js";
import { openDatabase } from "./database.js";
import { QuestRepository } from "./quest-repository.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function tempDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "raid-relay-"));
  directories.push(directory);
  return join(directory, "quest.sqlite");
}

describe("SQLite quest persistence", () => {
  it("keeps quest state and append-only history across close and reopen", () => {
    const path = tempDatabasePath();
    let database = openDatabase(path);
    let repository = new QuestRepository(database);
    let state = createInitialQuestState("persist-q", "source", 10);
    repository.save(state);
    const opened = reduceQuest(
      state,
      { type: "OPEN_NAMING", deadlineAt: 100 },
      20,
    );
    state = opened.state;
    repository.save(state, opened.events);
    const submitted = reduceQuest(
      state,
      { type: "SUBMIT_NAME_FOR_APPROVAL", name: "The Ember Fox" },
      100,
    );
    state = submitted.state;
    repository.save(state, submitted.events);
    database.close();

    database = openDatabase(path);
    repository = new QuestRepository(database);
    expect(repository.get("persist-q")).toEqual(state);
    expect(repository.events("persist-q")).toEqual([
      { sequence: 1, type: "naming.opened", at: 20, data: { deadlineAt: 100 } },
      {
        sequence: 2,
        type: "name.pending_approval",
        at: 100,
        data: {},
      },
    ]);
    database.close();
  });

  it("replaces one vote per hashed account and keeps idempotency keys unique", () => {
    const database = openDatabase(tempDatabasePath());
    const repository = new QuestRepository(database);
    repository.save(createInitialQuestState("vote-q", "channel", 1));
    const voterHash = "a".repeat(64);
    repository.upsertVote(
      "vote-q",
      1,
      { voterHash, faction: "raider", choice: "protect" },
      2,
    );
    repository.upsertVote(
      "vote-q",
      1,
      { voterHash, faction: "local", choice: "claim" },
      3,
    );
    expect(repository.votes("vote-q", 1)).toEqual([
      { voterHash, faction: "local", choice: "claim" },
    ]);
    expect(repository.recordIdempotencyKey("event-1", { ok: true }, 4)).toBe(
      true,
    );
    expect(repository.recordIdempotencyKey("event-1", { ok: false }, 5)).toBe(
      false,
    );
    database.close();
  });
});
