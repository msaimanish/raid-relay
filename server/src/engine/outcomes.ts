import type {
  Beat2Choice,
  Beat1Flag,
  Outcome,
  OutcomeKind,
  PartyTier,
} from "../../../shared/src/index.js";

export const BEAT2_CHOICES: readonly Beat2Choice[] = [
  "fight",
  "trade",
  "sneak",
];
export const OUTCOME_RULES = {
  base: { fight: 2, trade: 2, sneak: 2 },
  tierBonus: {
    fight: { small: 0, medium: 1, large: 2 },
    trade: { small: 1, medium: 1, large: 1 },
    sneak: { small: 2, medium: 1, large: 0 },
  },
  flagBonus: {
    bond: { fight: 0, trade: 1, sneak: 1 },
    power: { fight: 1, trade: 0, sneak: 0 },
  },
  thresholds: { triumph: 4, costly_win: 3 },
} as const;

const TEXT: Record<Beat2Choice, Record<OutcomeKind, string>> = {
  fight: {
    triumph:
      "The party breaks the troll's guard and carries the Ember Relic onward.",
    costly_win: "The troll is driven back, but the party leaves bruised.",
    setback: "The troll turns the party back; the Ember Relic is lost.",
  },
  trade: {
    triumph:
      "A fair bargain opens the bridge, and the party carries the Ember Relic onward.",
    costly_win: "The party pays a steep toll to cross with the relic.",
    setback:
      "The price proves too high; the party loses the relic at the bridge.",
  },
  sneak: {
    triumph:
      "The party slips past the troll and carries the relic safely onward.",
    costly_win: "The party sneaks through, leaving something precious behind.",
    setback:
      "The troll spots the party, and the relic is lost in the scramble.",
  },
};

export function calculateOutcome(
  choice: Beat2Choice,
  tier: PartyTier,
  flag: Beat1Flag,
): Outcome {
  const score =
    OUTCOME_RULES.base[choice] +
    OUTCOME_RULES.tierBonus[choice][tier] +
    OUTCOME_RULES.flagBonus[flag][choice];
  const kind: OutcomeKind =
    score >= OUTCOME_RULES.thresholds.triumph
      ? "triumph"
      : score >= OUTCOME_RULES.thresholds.costly_win
        ? "costly_win"
        : "setback";
  const relic =
    choice === "trade" ? "traded" : kind === "setback" ? "lost" : "kept";
  return {
    choice,
    kind,
    score,
    partyTier: tier,
    flag,
    text: TEXT[choice][kind],
    stateDelta: { relic, bond: flag === "bond" ? 1 : 0 },
  };
}
