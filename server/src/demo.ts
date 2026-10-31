import { openDatabase } from "./store/database.js";
import { runDemoScenario } from "./demo/scenario.js";

const database = openDatabase(":memory:");
try {
  const result = runDemoScenario(database, { startTime: Date.now() - 1_000 });
  console.log(
    JSON.stringify(
      {
        questId: result.questId,
        status: result.state.status,
        canonName: result.state.canonName,
        sourceChannelId: result.state.sourceChannelId,
        targetChannelId: result.state.targetChannelId,
        partySize: result.state.partySize,
        partyTier: result.state.partyTier,
        outcome: result.state.outcome,
        duplicateRaidIgnored: result.duplicateRaidIgnored,
        chainEvents: result.events,
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
