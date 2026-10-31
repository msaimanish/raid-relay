import { z } from "zod";

export const QuestStatusSchema = z.enum([
  "DRAFT",
  "NAMING_OPEN",
  "NAME_PENDING_APPROVAL",
  "BEAT1_VOTING",
  "AWAITING_RAID",
  "HANDOFF_OFFERED",
  "WELCOME",
  "BEAT2_VOTING",
  "COMPLETED",
  "HANDOFF_DISMISSED",
  "ABANDONED",
]);
export type QuestStatus = z.infer<typeof QuestStatusSchema>;
export const PartyTierSchema = z.enum(["small", "medium", "large"]);
export type PartyTier = z.infer<typeof PartyTierSchema>;
export const FactionSchema = z.enum(["raider", "local"]);
export type Faction = z.infer<typeof FactionSchema>;
export const Beat1ChoiceSchema = z.enum(["protect", "claim"]);
export type Beat1Choice = z.infer<typeof Beat1ChoiceSchema>;
export const Beat2ChoiceSchema = z.enum(["fight", "trade", "sneak"]);
export type Beat2Choice = z.infer<typeof Beat2ChoiceSchema>;
export const ChoiceSchema = z.union([Beat1ChoiceSchema, Beat2ChoiceSchema]);
export type Choice = z.infer<typeof ChoiceSchema>;
export const Beat1FlagSchema = z.enum(["bond", "power"]);
export type Beat1Flag = z.infer<typeof Beat1FlagSchema>;
export const OutcomeKindSchema = z.enum(["triumph", "costly_win", "setback"]);
export type OutcomeKind = z.infer<typeof OutcomeKindSchema>;

export const VoterHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const NameCandidateSchema = z.object({
  displayName: z.string().min(1).max(48),
  normalizedName: z.string().min(1).max(48),
});
export type NameCandidate = z.infer<typeof NameCandidateSchema>;
export const RankedNameProposalSchema = NameCandidateSchema.extend({
  supportCount: z.number().int().positive(),
  firstProposedAt: z.number().int(),
});
export type RankedNameProposal = z.infer<typeof RankedNameProposalSchema>;
export const NameAuditActionSchema = z.enum([
  "proposal_added",
  "proposal_supported",
  "proposal_replaced",
  "moderation_rejected",
  "vetoed",
  "approved",
  "default_selected",
]);
export type NameAuditAction = z.infer<typeof NameAuditActionSchema>;

export const EventSourceSchema = z.enum(["twitch", "demo"]);
export type EventSource = z.infer<typeof EventSourceSchema>;
export const RaidEventSchema = z.object({
  eventId: z.string().min(1).max(128),
  sourceChannelId: z.string().min(1),
  targetChannelId: z.string().min(1),
  viewers: z.number().int().nonnegative().nullable(),
  source: EventSourceSchema,
});
export type RaidEvent = z.infer<typeof RaidEventSchema>;
export const ChatMessageInputSchema = z.object({
  channelId: z.string().min(1),
  voterHash: VoterHashSchema,
  text: z.string().max(1000),
  source: EventSourceSchema,
});
export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>;

export const VoteSchema = z.object({
  voterHash: VoterHashSchema,
  faction: FactionSchema,
  choice: ChoiceSchema,
});
export type Vote = z.infer<typeof VoteSchema>;

export const VoteResolutionSchema = z.object({
  choice: ChoiceSchema,
  ruleVersion: z.literal("v1-equal-faction-share"),
  noVotes: z.boolean(),
  raw: z.record(
    z.string(),
    z.object({
      raider: z.number().int().nonnegative(),
      local: z.number().int().nonnegative(),
    }),
  ),
  shares: z.record(
    z.string(),
    z.object({
      raider: z.number().min(0).max(1),
      local: z.number().min(0).max(1),
      score: z.number().min(0).max(1),
    }),
  ),
  totals: z.object({
    raider: z.number().int().nonnegative(),
    local: z.number().int().nonnegative(),
  }),
});
export type VoteResolution = z.infer<typeof VoteResolutionSchema>;

export const OutcomeSchema = z.object({
  choice: Beat2ChoiceSchema,
  kind: OutcomeKindSchema,
  score: z.number().int(),
  partyTier: PartyTierSchema,
  flag: Beat1FlagSchema,
  text: z.string(),
  stateDelta: z.object({
    relic: z.enum(["kept", "traded", "lost"]),
    bond: z.number().int(),
  }),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const QuestStateSchema = z.object({
  id: z.string().min(1),
  templateId: z.literal("ember-relic-v1"),
  title: z.literal("The Ember Relic"),
  objective: z.literal("Carry the Ember Relic to the end of the road."),
  status: QuestStatusSchema,
  currentChannelId: z.string().min(1),
  sourceChannelId: z.string().nullable(),
  targetChannelId: z.string().nullable(),
  partySize: z.number().int().nonnegative().nullable(),
  partyTier: PartyTierSchema.nullable(),
  canonName: z.string().nullable(),
  pendingName: z.string().nullable(),
  beat1Flag: Beat1FlagSchema.nullable(),
  deadlineAt: z.number().int().nullable(),
  pausedAt: z.number().int().nullable(),
  lastVoteResolution: VoteResolutionSchema.nullable(),
  outcome: OutcomeSchema.nullable(),
  revision: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type QuestState = z.infer<typeof QuestStateSchema>;

export const QuestCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("OPEN_NAMING"), deadlineAt: z.number().int() }),
  z.object({
    type: z.literal("SUBMIT_NAME_FOR_APPROVAL"),
    name: z.string().min(1).max(48),
  }),
  z.object({ type: z.literal("APPROVE_NAME"), deadlineAt: z.number().int() }),
  z.object({ type: z.literal("REJECT_NAME") }),
  z.object({
    type: z.literal("USE_DEFAULT_NAME"),
    deadlineAt: z.number().int(),
  }),
  z.object({ type: z.literal("WINDOW_CLOSED"), votes: z.array(VoteSchema) }),
  z.object({
    type: z.literal("RAID_RECEIVED"),
    sourceChannelId: z.string().min(1),
    targetChannelId: z.string().min(1),
    viewers: z.number().int().nonnegative().nullable(),
    source: EventSourceSchema.optional(),
  }),
  z.object({ type: z.literal("ACCEPT_HANDOFF") }),
  z.object({ type: z.literal("DISMISS_HANDOFF") }),
  z.object({
    type: z.literal("OPEN_BEAT2_VOTING"),
    deadlineAt: z.number().int(),
  }),
  z.object({ type: z.literal("PAUSE") }),
  z.object({ type: z.literal("RESUME") }),
  z.object({ type: z.literal("ABANDON") }),
]);
export type QuestCommand = z.infer<typeof QuestCommandSchema>;

export const EngineEventSchema = z.object({
  type: z.string(),
  at: z.number().int(),
  data: z.record(z.string(), z.unknown()),
});
export type EngineEvent = z.infer<typeof EngineEventSchema>;
export interface EngineResult {
  state: QuestState;
  events: EngineEvent[];
  effects: [];
}

export function createInitialQuestState(
  id: string,
  channelId: string,
  now: number,
): QuestState {
  return QuestStateSchema.parse({
    id,
    templateId: "ember-relic-v1",
    title: "The Ember Relic",
    objective: "Carry the Ember Relic to the end of the road.",
    status: "DRAFT",
    currentChannelId: channelId,
    sourceChannelId: null,
    targetChannelId: null,
    partySize: null,
    partyTier: null,
    canonName: null,
    pendingName: null,
    beat1Flag: null,
    deadlineAt: null,
    pausedAt: null,
    lastVoteResolution: null,
    outcome: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
}
