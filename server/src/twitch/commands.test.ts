import { describe, expect, it } from "vitest";
import { parseChatCommand } from "./commands.js";

describe("chat command parser", () => {
  it("parses names, join, numbered votes, and keyed votes", () => {
    expect(parseChatCommand("!name Ember Fox", 1)).toEqual({
      type: "name",
      text: "Ember Fox",
    });
    expect(parseChatCommand("!JOIN", 2)).toEqual({ type: "join" });
    expect(parseChatCommand("!vote 2", 1)).toEqual({
      type: "vote",
      choice: "claim",
    });
    expect(parseChatCommand("!vote 3", 2)).toEqual({
      type: "vote",
      choice: "sneak",
    });
    expect(parseChatCommand("!vote TRADE", 2)).toEqual({
      type: "vote",
      choice: "trade",
    });
  });

  it.each([
    ["!vote", 1],
    ["!vote 0", 1],
    ["!vote 3", 1],
    ["!vote 1 2", 2],
    ["!vote protect", 2],
    ["!vote 1", null],
    ["!join now", 1],
    ["!namely fox", 1],
    ["!name", 1],
    ["!join\u200b", 1],
  ] as const)("ignores malformed command %s", (message, round) => {
    expect(parseChatCommand(message, round)).toBeNull();
  });

  it("returns null without throwing on untrusted inputs", () => {
    const inputs: unknown[] = [
      null,
      7,
      {},
      "!vote 💥",
      "\u0000!name fox",
      "!vote 2".repeat(200),
    ];
    for (const input of inputs) {
      expect(() => parseChatCommand(input, 2)).not.toThrow();
      expect(parseChatCommand(input, 2)).toBeNull();
    }
  });
});
