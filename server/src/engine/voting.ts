import {
  VoteSchema,
  VoteResolutionSchema,
  type Faction,
  type Vote,
  type VoteResolution,
} from "../../../shared/src/index.js";

export const VOTING_RULE_VERSION = "v1-equal-faction-share" as const;

/**
 * Resolves votes using equal faction share. Each voterHash is counted once;
 * duplicate rows are treated as replacements, with the last supplied vote winning.
 */
export function resolveVotes(
  votes: readonly Vote[],
  choices: readonly string[],
  defaultChoice: string,
): VoteResolution {
  if (choices.length === 0 || !choices.includes(defaultChoice)) {
    throw new Error(
      "The default choice must be present in a non-empty choice list.",
    );
  }
  if (new Set(choices).size !== choices.length)
    throw new Error("Choice order cannot contain duplicates.");

  const latestByVoter = new Map<string, Vote>();
  for (const input of votes) {
    const vote = VoteSchema.parse(input);
    if (choices.includes(vote.choice)) latestByVoter.set(vote.voterHash, vote);
  }
  const counts = Object.fromEntries(
    choices.map((choice) => [choice, { raider: 0, local: 0 }]),
  ) as Record<string, Record<Faction, number>>;
  let raiderTotal = 0;
  let localTotal = 0;
  for (const vote of latestByVoter.values()) {
    counts[vote.choice]![vote.faction] += 1;
    if (vote.faction === "raider") raiderTotal += 1;
    else localTotal += 1;
  }

  const shares = Object.fromEntries(
    choices.map((choice) => {
      const raw = counts[choice]!;
      const raider = raiderTotal === 0 ? 0 : raw.raider / raiderTotal;
      const local = localTotal === 0 ? 0 : raw.local / localTotal;
      const score =
        raiderTotal > 0 && localTotal > 0
          ? 0.5 * raider + 0.5 * local
          : raiderTotal > 0
            ? raider
            : local;
      return [choice, { raider, local, score }];
    }),
  );

  let selected = defaultChoice;
  if (raiderTotal + localTotal > 0) {
    selected = [...choices].sort((a, b) => {
      const shareDifference = shares[b]!.score - shares[a]!.score;
      if (shareDifference !== 0) return shareDifference;
      const rawDifference =
        counts[b]!.raider +
        counts[b]!.local -
        counts[a]!.raider -
        counts[a]!.local;
      if (rawDifference !== 0) return rawDifference;
      return choices.indexOf(a) - choices.indexOf(b);
    })[0]!;
  }

  return VoteResolutionSchema.parse({
    choice: selected,
    ruleVersion: VOTING_RULE_VERSION,
    noVotes: raiderTotal + localTotal === 0,
    raw: counts,
    shares,
    totals: { raider: raiderTotal, local: localTotal },
  });
}
