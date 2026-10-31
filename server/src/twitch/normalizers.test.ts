import { describe, expect, it } from "vitest";
import { normalizeChatFixture, normalizeRaidFixture } from "./normalizers.js";

// Sanitized illustrative payloads matching Twitch's documented EventSub event shape.
// They are contract fixtures, not payloads captured from this app's live channels.
describe("Twitch EventSub payload fixtures", () => {
  it("parses documented chat message fields", () => {
    expect(
      normalizeChatFixture({
        message_id: "fixture-message-001",
        broadcaster_user_id: "1001",
        chatter_user_id: "2002",
        message: { text: "!vote protect" },
      }),
    ).toEqual({
      eventId: "fixture-message-001",
      broadcasterId: "1001",
      chatterId: "2002",
      text: "!vote protect",
    });
  });

  it("preserves raid viewer count and rejects malformed payloads", () => {
    expect(
      normalizeRaidFixture({
        from_broadcaster_user_id: "1001",
        to_broadcaster_user_id: "3003",
        viewers: 42,
      }),
    ).toEqual({
      sourceBroadcasterId: "1001",
      targetBroadcasterId: "3003",
      viewers: 42,
    });
    expect(() =>
      normalizeRaidFixture({
        from_broadcaster_user_id: "1001",
        to_broadcaster_user_id: "3003",
        viewers: -1,
      }),
    ).toThrow();
  });
});
