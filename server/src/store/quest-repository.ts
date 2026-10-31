import {
  EventSourceSchema,
  NameAuditActionSchema,
  NameCandidateSchema,
  RankedNameProposalSchema,
  QuestStateSchema,
  VoterHashSchema,
  VoteSchema,
  type EngineEvent,
  type EventSource,
  type Faction,
  type NameAuditAction,
  type NameCandidate,
  type RankedNameProposal,
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

  saveWithNameAudit(
    stateInput: QuestState,
    events: readonly EngineEvent[],
    actorHashInput: string | null,
    actionInput: NameAuditAction,
    normalizedName: string | null,
    createdAt: number,
  ): void {
    const state = QuestStateSchema.parse(stateInput);
    const actorHash =
      actorHashInput === null ? null : VoterHashSchema.parse(actorHashInput);
    const action = NameAuditActionSchema.parse(actionInput);
    if (!Number.isSafeInteger(createdAt))
      throw new RangeError("Audit time must be an integer timestamp.");
    this.database.transaction(() => {
      this.save(state, events);
      this.insertNameAudit(
        state.id,
        actorHash,
        action,
        normalizedName,
        createdAt,
      );
    })();
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

  all(): QuestState[] {
    const rows = this.database
      .prepare(
        "SELECT id FROM quests ORDER BY updated_at DESC, created_at DESC",
      )
      .all() as Array<{ id: string }>;
    return rows.flatMap(({ id }) => {
      const state = this.get(id);
      return state ? [state] : [];
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
    sourceInput: EventSource = "twitch",
  ): void {
    const vote = VoteSchema.parse(voteInput);
    const source = EventSourceSchema.parse(sourceInput);
    if (!Number.isSafeInteger(createdAt))
      throw new RangeError("Vote time must be an integer timestamp.");
    const choices =
      round === 1 ? ["protect", "claim"] : ["fight", "trade", "sneak"];
    if (!choices.includes(vote.choice))
      throw new Error(`Choice ${vote.choice} is not valid for round ${round}.`);
    this.database
      .prepare(
        `
      INSERT INTO votes (quest_id, round, voter_hash, faction, choice, created_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (quest_id, round, voter_hash) DO UPDATE SET faction=excluded.faction, choice=excluded.choice, created_at=excluded.created_at, source=excluded.source
    `,
      )
      .run(
        questId,
        round,
        vote.voterHash,
        vote.faction,
        vote.choice,
        createdAt,
        source,
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

  runIdempotent<T>(
    key: string,
    createdAt: number,
    operation: () => T,
  ): { duplicate: boolean; result: T } {
    if (!key || key.length > 256)
      throw new RangeError("Idempotency key must contain 1–256 characters.");
    if (!Number.isSafeInteger(createdAt))
      throw new RangeError("Idempotency time must be an integer timestamp.");
    return this.database.transaction(() => {
      const previous = this.database
        .prepare("SELECT result_json FROM idempotency_keys WHERE key = ?")
        .get(key) as { result_json: string } | undefined;
      if (previous) {
        return {
          duplicate: true,
          result: JSON.parse(previous.result_json) as T,
        };
      }
      const result = operation();
      this.database
        .prepare(
          "INSERT INTO idempotency_keys (key, result_json, created_at) VALUES (?, ?, ?)",
        )
        .run(key, JSON.stringify(result), createdAt);
      return { duplicate: false, result };
    })();
  }

  findAwaitingRaidBySource(sourceChannelId: string): QuestState | null {
    const row = this.database
      .prepare(
        "SELECT id FROM quests WHERE status = 'AWAITING_RAID' AND current_channel_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1",
      )
      .get(sourceChannelId) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  findActiveQuestByChannel(channelId: string): QuestState | null {
    const row = this.database
      .prepare(
        "SELECT id FROM quests WHERE (current_channel_id = ? OR source_channel_id = ?) AND status IN ('DRAFT', 'NAMING_OPEN', 'NAME_PENDING_APPROVAL', 'BEAT1_VOTING', 'AWAITING_RAID', 'HANDOFF_OFFERED', 'WELCOME', 'BEAT2_VOTING') ORDER BY CASE WHEN current_channel_id = ? THEN 0 ELSE 1 END, updated_at DESC, created_at DESC LIMIT 1",
      )
      .get(channelId, channelId, channelId) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  findLatestQuestByChannel(channelId: string): QuestState | null {
    const row = this.database
      .prepare(
        "SELECT id FROM quests WHERE current_channel_id = ? OR source_channel_id = ? ORDER BY CASE WHEN current_channel_id = ? THEN 0 ELSE 1 END, updated_at DESC, created_at DESC LIMIT 1",
      )
      .get(channelId, channelId, channelId) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  markSourceParticipant(
    questId: string,
    voterHashInput: string,
    sourceInput: EventSource,
    firstSeenAt: number,
  ): void {
    this.markParticipant(
      questId,
      voterHashInput,
      "source",
      sourceInput,
      firstSeenAt,
    );
  }

  markTargetJoin(
    questId: string,
    voterHashInput: string,
    sourceInput: EventSource,
    firstSeenAt: number,
  ): void {
    this.markParticipant(
      questId,
      voterHashInput,
      "target_join",
      sourceInput,
      firstSeenAt,
    );
  }

  private markParticipant(
    questId: string,
    voterHashInput: string,
    cohort: "source" | "target_join",
    sourceInput: EventSource,
    firstSeenAt: number,
  ): void {
    const voterHash = VoterHashSchema.parse(voterHashInput);
    const source = EventSourceSchema.parse(sourceInput);
    if (!Number.isSafeInteger(firstSeenAt))
      throw new RangeError("Participant time must be an integer timestamp.");
    this.database
      .prepare(
        "INSERT OR IGNORE INTO quest_participants (quest_id, voter_hash, cohort, source, first_seen_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(questId, voterHash, cohort, source, firstSeenAt);
  }

  factionForVote(questId: string, voterHashInput: string): Faction {
    const voterHash = VoterHashSchema.parse(voterHashInput);
    const participant = this.database
      .prepare(
        "SELECT 1 FROM quest_participants WHERE quest_id = ? AND voter_hash = ? LIMIT 1",
      )
      .get(questId, voterHash);
    return participant ? "raider" : "local";
  }

  recordNameProposal(
    questId: string,
    voterHashInput: string,
    candidateInput: NameCandidate,
    createdAt: number,
  ): "proposal_added" | "proposal_supported" | "proposal_replaced" {
    if (!Number.isSafeInteger(createdAt))
      throw new RangeError("Proposal time must be an integer timestamp.");
    const voterHash = VoterHashSchema.parse(voterHashInput);
    const candidate = NameCandidateSchema.parse(candidateInput);
    if (candidate.normalizedName !== candidate.displayName.toLowerCase())
      throw new Error(
        "Candidate normalizedName must be the lower-case displayName.",
      );
    return this.database.transaction(() => {
      const previous = this.database
        .prepare(
          "SELECT normalized_name FROM name_proposals WHERE quest_id = ? AND voter_hash = ?",
        )
        .get(questId, voterHash) as { normalized_name: string } | undefined;
      const action = !previous
        ? "proposal_added"
        : previous.normalized_name === candidate.normalizedName
          ? "proposal_supported"
          : "proposal_replaced";
      this.database
        .prepare(
          `
        INSERT INTO name_proposals (quest_id, voter_hash, normalized_name, display_name, first_proposed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (quest_id, voter_hash) DO UPDATE SET
          normalized_name=excluded.normalized_name,
          display_name=CASE WHEN name_proposals.normalized_name = excluded.normalized_name THEN name_proposals.display_name ELSE excluded.display_name END,
          first_proposed_at=CASE WHEN name_proposals.normalized_name = excluded.normalized_name THEN name_proposals.first_proposed_at ELSE excluded.first_proposed_at END
      `,
        )
        .run(
          questId,
          voterHash,
          candidate.normalizedName,
          candidate.displayName,
          createdAt,
        );
      this.insertNameAudit(
        questId,
        voterHash,
        action,
        candidate.normalizedName,
        createdAt,
      );
      return action;
    })();
  }

  recordNameAudit(
    questId: string,
    actorHashInput: string | null,
    actionInput: NameAuditAction,
    normalizedName: string | null,
    createdAt: number,
  ): void {
    if (!Number.isSafeInteger(createdAt))
      throw new RangeError("Audit time must be an integer timestamp.");
    const actorHash =
      actorHashInput === null ? null : VoterHashSchema.parse(actorHashInput);
    const action = NameAuditActionSchema.parse(actionInput);
    this.insertNameAudit(questId, actorHash, action, normalizedName, createdAt);
  }

  private insertNameAudit(
    questId: string,
    actorHash: string | null,
    action: NameAuditAction,
    normalizedName: string | null,
    createdAt: number,
  ): void {
    this.database
      .prepare(
        "INSERT INTO name_audit (quest_id, actor_hash, action, normalized_name, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(questId, actorHash, action, normalizedName, createdAt);
  }

  vetoedNameKeys(questId: string): ReadonlySet<string> {
    const rows = this.database
      .prepare(
        "SELECT DISTINCT normalized_name FROM name_audit WHERE quest_id = ? AND action = 'vetoed' AND normalized_name IS NOT NULL",
      )
      .all(questId) as Array<{ normalized_name: string }>;
    return new Set(rows.map((row) => row.normalized_name));
  }

  rankNameProposals(questId: string): RankedNameProposal[] {
    const rows = this.database
      .prepare(
        `
        SELECT p.normalized_name,
          (SELECT d.display_name FROM name_proposals d WHERE d.quest_id = p.quest_id AND d.normalized_name = p.normalized_name ORDER BY d.first_proposed_at, d.voter_hash LIMIT 1) AS display_name,
          COUNT(*) AS support_count,
          MIN(p.first_proposed_at) AS first_proposed_at
        FROM name_proposals p
        WHERE p.quest_id = ? AND p.normalized_name NOT IN (
          SELECT normalized_name FROM name_audit WHERE quest_id = ? AND action = 'vetoed' AND normalized_name IS NOT NULL
        )
        GROUP BY p.normalized_name
        ORDER BY support_count DESC, first_proposed_at ASC, p.normalized_name ASC
      `,
      )
      .all(questId, questId) as Array<Record<string, unknown>>;
    return rows.map((row) =>
      RankedNameProposalSchema.parse({
        normalizedName: row.normalized_name,
        displayName: row.display_name,
        supportCount: row.support_count,
        firstProposedAt: row.first_proposed_at,
      }),
    );
  }
}
