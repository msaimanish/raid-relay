import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ApiClient } from "@twurple/api";
import { getTokenInfo, StaticAuthProvider } from "@twurple/auth";
import { EventSubWsListener } from "@twurple/eventsub-ws";

const fingerprint = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);
const clientId = process.env.TWITCH_CLIENT_ID;
const channelLogins = (process.env.CHANNELS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const tokenPath = process.env.TWITCH_TOKEN_FILE ?? "./.data/twitch-tokens.json";

if (!clientId || channelLogins.length === 0) {
  console.error(
    "Set TWITCH_CLIENT_ID and CHANNELS in .env before running this script.",
  );
  process.exitCode = 1;
} else {
  try {
    const token = JSON.parse(await readFile(tokenPath, "utf8")) as {
      access_token?: string;
      scope?: string[];
    };
    if (!token.access_token)
      throw new Error(
        "Token file has no access_token; run pnpm twitch:auth first.",
      );
    const authProvider = new StaticAuthProvider(
      clientId,
      token.access_token,
      token.scope ?? [],
    );
    const apiClient = new ApiClient({ authProvider });
    const listener = new EventSubWsListener({ apiClient });
    await listener.start();
    const tokenInfo = await getTokenInfo(token.access_token, clientId);
    if (!tokenInfo.userId)
      throw new Error("Twitch did not return an account ID for this token.");
    const user = await apiClient.users.getUserById(tokenInfo.userId);
    if (!user) throw new Error("Unable to resolve the authorized Twitch user.");
    console.log(
      `Connected as account ${fingerprint(user.id)}. Waiting for chat and outgoing raids.`,
    );
    for (const login of channelLogins) {
      const channel = await apiClient.users.getUserByName(login);
      if (!channel) {
        console.error(
          `Configured channel not found (login fingerprint ${fingerprint(login.toLowerCase())}).`,
        );
        continue;
      }
      listener.onChannelChatMessage(channel.id, user.id, (event) => {
        console.log(
          JSON.stringify({
            type: "chat.message",
            channel: fingerprint(event.broadcasterId),
            user: fingerprint(event.chatterId),
            receivedAt: new Date().toISOString(),
          }),
        );
      });
      listener.onChannelRaidFrom(channel.id, (event) => {
        console.log(
          JSON.stringify({
            type: "channel.raid",
            source: fingerprint(event.raidingBroadcasterId),
            target: fingerprint(event.raidedBroadcasterId),
            viewers: event.viewers,
          }),
        );
      });
      console.log(
        `Subscriptions requested for channel ${fingerprint(channel.id)}.`,
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Twitch smoke setup failed",
    );
    process.exitCode = 1;
  }
}
