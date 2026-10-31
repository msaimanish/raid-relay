import { VoterHashSchema } from "../../../shared/src/index.js";

/** In-memory sliding-window limit for parsed chat commands; persist no account IDs. */
export class CommandFloodLimiter {
  private readonly timestamps = new Map<string, number[]>();

  constructor(
    private readonly maxCommands = 20,
    private readonly windowMs = 10_000,
  ) {
    if (!Number.isInteger(maxCommands) || maxCommands < 1)
      throw new RangeError("maxCommands must be a positive integer.");
    if (!Number.isInteger(windowMs) || windowMs < 1)
      throw new RangeError("windowMs must be a positive integer.");
  }

  accept(voterHashInput: string, now: number): boolean {
    const voterHash = VoterHashSchema.parse(voterHashInput);
    if (!Number.isSafeInteger(now))
      throw new RangeError("Command time must be an integer timestamp.");
    const cutoff = now - this.windowMs;
    const current = (this.timestamps.get(voterHash) ?? []).filter(
      (at) => at > cutoff,
    );
    if (current.length >= this.maxCommands) {
      this.timestamps.set(voterHash, current);
      return false;
    }
    current.push(now);
    this.timestamps.set(voterHash, current);
    return true;
  }
}
