import { describe, expect, it } from "vitest";
import { createVoterHash, normalizeTwitchToken } from "./runtime.js";

describe("Twitch runtime helpers", () => {
  it("normalizes old and current token files for automatic refresh", () => {
    expect(
      normalizeTwitchToken({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        scope: ["user:read:chat"],
      }),
    ).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      scope: ["user:read:chat"],
    });
  });

  it("uses a keyed digest for voter identities", () => {
    expect(createVoterHash("123", "salt")).toHaveLength(64);
    expect(createVoterHash("123", "salt")).toBe(createVoterHash("123", "salt"));
    expect(createVoterHash("123", "salt")).not.toBe(
      createVoterHash("123", "other"),
    );
  });
});
