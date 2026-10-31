import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { ApiClient } from "@twurple/api";
import {
  getTokenInfo,
  RefreshingAuthProvider,
  type AccessToken,
} from "@twurple/auth";
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
    const token = JSON.parse(
      await readFile(tokenPath, "utf8"),
    ) as AccessToken & {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const accessToken = token.accessToken ?? token.access_token;
    if (!accessToken || !(token.refreshToken ?? token.refresh_token))
      throw new Error(
        "Token file is missing access or refresh token; run pnpm twitch:auth first.",
      );
    const authProvider = new RefreshingAuthProvider({
      clientId,
      clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    });
    const tokenData: AccessToken = {
      accessToken,
      refreshToken: token.refreshToken ?? token.refresh_token ?? null,
      expiresIn: token.expiresIn ?? token.expires_in ?? null,
      obtainmentTimestamp: token.obtainmentTimestamp ?? Date.now(),
      scope: token.scope ?? [],
    };
    const userId = await authProvider.addUserForToken(tokenData);
    authProvider.on(authProvider.onRefresh, async (_id, refreshed) => {
      await writeFile(tokenPath, JSON.stringify(refreshed, null, 2), {
        mode: 0o600,
      });
    });
    const apiClient = new ApiClient({ authProvider });
    const listener = new EventSubWsListener({ apiClient });
    await listener.start();
    const tokenInfo = await getTokenInfo(accessToken, clientId);
    if (!tokenInfo.userId || tokenInfo.userId !== userId)
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
