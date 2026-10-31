import type {
  Beat1Choice,
  Beat2Choice,
  Choice,
} from "../../../shared/src/index.js";

export type VoteRound = 1 | 2;
export type ParsedChatCommand =
  | { type: "name"; text: string }
  | { type: "vote"; choice: Choice }
  | { type: "join" };

const ROUND_CHOICES: Record<VoteRound, readonly Choice[]> = {
  1: ["protect", "claim"] satisfies readonly Beat1Choice[],
  2: ["fight", "trade", "sneak"] satisfies readonly Beat2Choice[],
};

/** Returns null for any unsupported or malformed chat message; it never throws. */
export function parseChatCommand(
  input: unknown,
  round: VoteRound | null,
): ParsedChatCommand | null {
  if (typeof input !== "string" || input.length > 1000) return null;
  const message = input.trim();
  if (/^!join$/iu.test(message)) return { type: "join" };

  const nameMatch = /^!name\s+(.+)$/isu.exec(message);
  if (nameMatch?.[1]) return { type: "name", text: nameMatch[1].trim() };

  const voteMatch = /^!vote\s+(\S+)$/iu.exec(message);
  if (!voteMatch || !round) return null;
  const key = voteMatch[1]!.toLowerCase();
  const choices = ROUND_CHOICES[round];
  const numericChoice = /^[1-9]$/u.test(key)
    ? choices[Number(key) - 1]
    : undefined;
  const namedChoice = choices.find((choice) => choice === key);
  const choice = numericChoice ?? namedChoice;
  return choice ? { type: "vote", choice } : null;
}
