import { config as loadDotEnv } from "dotenv";
import { resolve } from "node:path";
import { projectRootFromCwd } from "./config/project-paths.js";
import { createRelayServer, loadServerConfig } from "./http/server.js";

loadDotEnv({ path: resolve(projectRootFromCwd(), ".env") });
const config = loadServerConfig();
const relay = await createRelayServer(config);

try {
  await relay.app.listen({ port: config.port, host: "127.0.0.1" });
  relay.app.log.info({ port: config.port }, "Raid Relay server listening");
} catch (error) {
  relay.app.log.error(error);
  await relay.close();
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void relay.close().then(() => process.exit(0));
  });
}
