import { describe, expect, it } from "vitest";
import { moderateCandidateName, normalizeCandidateName } from "./name.js";

describe("candidate name normalization and moderation", () => {
  it("normalizes compatibility Unicode and strips zero-width format controls", () => {
    expect(normalizeCandidateName("  Ｅｍｂｅｒ\u200b   Fox  ")).toEqual({
      displayName: "Ember Fox",
      normalizedName: "ember fox",
    });
    expect(moderateCandidateName("Ｅｍｂｅｒ\u200b Fox")).toEqual({
      allowed: true,
      candidate: { displayName: "Ember Fox", normalizedName: "ember fox" },
    });
  });

  it.each([
    ["", "empty"],
    ["     ", "empty"],
    ["x".repeat(25), "too_long"],
    ["visit https://example.com", "url"],
    ["raidrelay.tv", "url"],
    ["@streamer", "mention"],
    ["Hello @streamer", "mention"],
    ["FＵＣＫ", "blocked_term"],
    ["F\u200bUCK", "blocked_term"],
    ["<b>Fox</b>", "invalid_characters"],
    ["Fox🙂", "invalid_characters"],
  ] as const)("rejects unsafe input %s", (raw, reason) => {
    expect(moderateCandidateName(raw)).toEqual({ allowed: false, reason });
  });

  it("allows Unicode letters and safe punctuation", () => {
    const result = moderateCandidateName("Éclair-Sage");
    expect(result).toEqual({
      allowed: true,
      candidate: { displayName: "Éclair-Sage", normalizedName: "éclair-sage" },
    });
  });

  it("never throws on malformed Unicode or arbitrary bounded strings", () => {
    const fuzzInputs = [
      "\u0000\u202eFox",
      "\ud800Fox",
      "\u200d\ufeff",
      "<script>alert(1)</script>",
      "a".repeat(512),
      "a".repeat(513),
      "\n\t  Fox \t\n",
      "🦊".repeat(10),
    ];
    for (const input of fuzzInputs) {
      expect(() => moderateCandidateName(input)).not.toThrow();
      const first = moderateCandidateName(input);
      expect(moderateCandidateName(input)).toEqual(first);
    }
  });
});
