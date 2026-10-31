import { describe, expect, it } from "vitest";
import { CommandFloodLimiter } from "./command-limiter.js";

describe("command flood limiter", () => {
  it("accepts at most 20 commands per hashed account in each rolling 10-second window", () => {
    const limiter = new CommandFloodLimiter();
    const account = "a".repeat(64);
    for (let index = 0; index < 20; index += 1)
      expect(limiter.accept(account, 1_000 + index)).toBe(true);
    expect(limiter.accept(account, 1_100)).toBe(false);
    expect(limiter.accept("b".repeat(64), 1_100)).toBe(true);
    expect(limiter.accept(account, 11_001)).toBe(true);
  });
});
