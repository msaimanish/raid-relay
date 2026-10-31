import type { NameCandidate } from "../../../shared/src/index.js";

export type NameRejectionReason =
  | "empty"
  | "too_long"
  | "url"
  | "mention"
  | "blocked_term"
  | "invalid_characters";

export type NameModerationResult =
  | { allowed: true; candidate: NameCandidate }
  | { allowed: false; reason: NameRejectionReason };

const FORMAT_CHARACTERS = /\p{Cf}/gu;
const BLOCKED_TERMS = ["asshole", "bitch", "cunt", "dick", "fuck", "shit"];
const URL_LIKE =
  /(?:https?:\/\/|www\.|\b[\p{L}\p{N}-]+\.(?:com|net|org|gg|tv|io)\b)/iu;
const MENTION = /(?:^|\s)@[\p{L}\p{N}_]+/u;
const NAME_CHARACTERS = /^[\p{L}\p{M}\p{N}]+(?:[ '-][\p{L}\p{M}\p{N}]+)*$/u;

/** Makes names stable across compatibility forms, case, and invisible format controls. */
export function normalizeCandidateName(raw: string): NameCandidate {
  const displayName = raw
    .normalize("NFKC")
    .replace(FORMAT_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim();
  return { displayName, normalizedName: displayName.toLowerCase() };
}

export function moderateCandidateName(
  raw: string,
  blockedTerms: readonly string[] = BLOCKED_TERMS,
): NameModerationResult {
  if (typeof raw !== "string" || raw.length > 512)
    return { allowed: false, reason: "too_long" };
  const candidate = normalizeCandidateName(raw);
  if (candidate.displayName.length === 0)
    return { allowed: false, reason: "empty" };
  if (URL_LIKE.test(candidate.displayName))
    return { allowed: false, reason: "url" };
  if (MENTION.test(candidate.displayName))
    return { allowed: false, reason: "mention" };
  if (Array.from(candidate.displayName).length > 24)
    return { allowed: false, reason: "too_long" };
  const words = new Set(candidate.normalizedName.split(/[^\p{L}\p{N}]+/u));
  const blocked = blockedTerms.some((term) => {
    const normalizedTerm = term
      .normalize("NFKC")
      .replace(FORMAT_CHARACTERS, "")
      .toLowerCase();
    return normalizedTerm.length > 0 && words.has(normalizedTerm);
  });
  if (blocked) return { allowed: false, reason: "blocked_term" };
  if (!NAME_CHARACTERS.test(candidate.displayName))
    return { allowed: false, reason: "invalid_characters" };
  return { allowed: true, candidate };
}

export const SAFE_DEFAULT_NAME = "the Ember Fox";
