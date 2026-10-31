import {
  QuestStateSchema,
  VoteSchema,
  type EngineEvent,
  type QuestState,
  type Vote,
} from "../../../shared/src/index.js";
import type { RelayDatabase } from "./database.js";

export interface StoredQuestEvent extends EngineEvent {
  sequence: number;
}

export class QuestRepository {
  constructor(private readonly database: RelayDatabase) {}

  save(stateInput: QuestState, events: readonly EngineEvent[] = []): void {
    const state = QuestStateSchema.parse(stateInput);
    const saveTransaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
        INSERT INTO quests (
          id, template_id, title, objective, status, current_channel_id, source_channel_id,
          target_channel_id, party_size, party_tier, canon_name, pending_name, beat1_flag,
          deadline_at, paused_at, last_vote_resolution_json, outcome_json, revision, created_at, updated_at
        ) VALUES (
          @id, @templateId, @title, @objective, @status, @currentChannelId, @sourceChannelId,
          @targetChannelId, @partySize, @partyTier, @canonName, @pendingName, @beat1Flag,
          @deadlineAt, @pausedAt, @lastVoteResolution, @outcome, @revision, @createdAt, @updatedAt
        ) ON CONFLICT(id) DO UPDATE SET
          status=excluded.status, current_channel_id=excluded.current_channel_id,
          source_channel_id=excluded.source_channel_id, target_channel_id=excluded.target_channel_id,
          party_size=excluded.party_size, party_tier=excluded.party_tier, canon_name=excluded.canon_name,
          pending_name=excluded.pending_name, beat1_flag=excluded.beat1_flag, deadline_at=excluded.deadline_at,
          paused_at=excluded.paused_at, last_vote_resolution_json=excluded.last_vote_resolution_json,
          outcome_json=excluded.outcome_json, revision=excluded.revision, updated_at=excluded.updated_at
      `,
        )
        .run({
          ...state,
          lastVoteResolution:
            state.lastVoteResolution === null
              ? null
              : JSON.stringify(state.lastVoteResolution),
          outcome:
            state.outcome === null ? null : JSON.stringify(state.outcome),
        });

      const nextSequence = (
        this.database
          .prepare(
            "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM quest_events WHERE quest_id = ?",
          )
          .get(state.id) as { next: number }
      ).next;
      const append = this.database.prepare(
        "INSERT INTO quest_events (quest_id, sequence, type, timestamp, payload_json) VALUES (?, ?, ?, ?, ?)",
      );
      events.forEach((event, index) =>
        append.run(
          state.id,
          nextSequence + index,
          event.type,
          event.at,
          JSON.stringify(event.data),
        ),
      );
    });
    saveTransaction();
  }

  get(questId: string): QuestState | null {
    const row = this.database
      .prepare("SELECT * FROM quests WHERE id = ?")
      .get(questId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return QuestStateSchema.parse({
      id: row.id,
      templateId: row.template_id,
      title: row.title,
      objective: row.objective,
      status: row.status,
      currentChannelId: row.current_channel_id,
      sourceChannelId: row.source_channel_id,
      targetChannelId: row.target_channel_id,
      partySize: row.party_size,
      partyTier: row.party_tier,
      canonName: row.canon_name,
      pendingName: row.pending_name,
      beat1Flag: row.beat1_flag,
      deadlineAt: row.deadline_at,
      pausedAt: row.paused_at,
      lastVoteResolution:
        row.last_vote_resolution_json === null
          ? null
          : (JSON.parse(String(row.last_vote_resolution_json)) as unknown),
      outcome:
        row.outcome_json === null
          ? null
          : (JSON.parse(String(row.outcome_json)) as unknown),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  events(questId: string): StoredQuestEvent[] {
    const rows = this.database
      .prepare(
        "SELECT sequence, type, timestamp, payload_json FROM quest_events WHERE quest_id = ? ORDER BY sequence",
      )
      .all(questId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      type: String(row.type),
      at: Number(row.timestamp),
      data: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    }));
  }

  upsertVote(
    questId: string,
    round: 1 | 2,
    voteInput: Vote,
    createdAt: number,
  ): void {
    const vote = VoteSchema.parse(voteInput);
    const choices =
      round === 1 ? ["protect", "claim"] : ["fight", "trade", "sneak"];
    if (!choices.includes(vote.choice))
      throw new Error(`Choice ${vote.choice} is not valid for round ${round}.`);
    this.database
      .prepare(
        `
      INSERT INTO votes (quest_id, round, voter_hash, faction, choice, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (quest_id, round, voter_hash) DO UPDATE SET faction=excluded.faction, choice=excluded.choice, created_at=excluded.created_at
    `,
      )
      .run(
        questId,
        round,
        vote.voterHash,
        vote.faction,
        vote.choice,
        createdAt,
      );
  }

  votes(questId: string, round: 1 | 2): Vote[] {
    return (
      this.database
        .prepare(
          "SELECT voter_hash, faction, choice FROM votes WHERE quest_id = ? AND round = ? ORDER BY voter_hash",
        )
        .all(questId, round) as Array<Record<string, unknown>>
    ).map((row) =>
      VoteSchema.parse({
        voterHash: row.voter_hash,
        faction: row.faction,
        choice: row.choice,
      }),
    );
  }

  recordIdempotencyKey(
    key: string,
    result: unknown,
    createdAt: number,
  ): boolean {
    const outcome = this.database
      .prepare(
        "INSERT OR IGNORE INTO idempotency_keys (key, result_json, created_at) VALUES (?, ?, ?)",
      )
      .run(key, JSON.stringify(result), createdAt);
    return outcome.changes === 1;
  }
}
