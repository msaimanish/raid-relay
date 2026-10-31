import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../store/database.js";
import { runDemoScenario } from "./scenario.js";

const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("scripted two-channel scenario", () => {
  it("drives the shared bus end-to-end and preserves raw raid size and faction tallies", () => {
    const database = openDatabase(":memory:");
    databases.push(database);
    const result = runDemoScenario(database);
    const beat2 = result.events.find(
      (event) => event.type === "beat2.resolved",
    );
    const resolution = beat2?.data.resolution as
      | {
          choice: string;
          raw: Record<string, { raider: number; local: number }>;
          totals: { raider: number; local: number };
        }
      | undefined;

    expect(result.state.status).toBe("COMPLETED");
    expect(result.state.canonName).toBe("Ember Fox");
    expect(result.state.sourceChannelId).toBe("demo-channel-a");
    expect(result.state.targetChannelId).toBe("demo-channel-b");
    expect(result.state.partySize).toBe(37);
    expect(result.state.partyTier).toBe("medium");
    expect(result.state.outcome).toMatchObject({
      choice: "fight",
      kind: "costly_win",
      score: 3,
    });
    expect(resolution).toMatchObject({
      choice: "fight",
      raw: { fight: { raider: 0, local: 2 }, trade: { raider: 1, local: 0 } },
      totals: { raider: 1, local: 2 },
    });
    expect(result.duplicateRaidIgnored).toBe(true);
    expect(result.events.some((event) => event.type === "demo.input")).toBe(
      true,
    );
    expect(
      result.events.filter((event) => event.type === "raid.received"),
    ).toHaveLength(1);
    const serialized = JSON.stringify(result.events);
    expect(serialized).not.toContain("voterHash");
    expect(serialized).not.toContain("demo:alpha");
  });
});
