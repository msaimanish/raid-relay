import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ApiClient } from "@twurple/api";
import { RefreshingAuthProvider, type AccessToken } from "@twurple/auth";
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
    const parsed = JSON.parse(await readFile(tokenPath, "utf8")) as unknown;
    const tokens = (Array.isArray(parsed) ? parsed : [parsed]) as Array<
      Partial<AccessToken> & {
        userId?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      }
    >;
    if (!tokens.length) throw new Error("Token file contains no user tokens.");
    const authProvider = new RefreshingAuthProvider({
      clientId,
      clientSecret: process.env.TWITCH_CLIENT_SECRET ?? "",
    });
    const tokenByUserId = new Map<string, AccessToken & { userId: string }>();
    for (const token of tokens) {
      const tokenData: AccessToken = {
        accessToken: token.accessToken ?? token.access_token ?? "",
        refreshToken: token.refreshToken ?? token.refresh_token ?? null,
        expiresIn: token.expiresIn ?? token.expires_in ?? null,
        obtainmentTimestamp: token.obtainmentTimestamp ?? Date.now(),
        scope: token.scope ?? [],
      };
      if (!tokenData.accessToken || !tokenData.refreshToken)
        throw new Error("A token is missing access or refresh token.");
      const id = await authProvider.addUserForToken(tokenData);
      tokenByUserId.set(id, { ...tokenData, userId: id });
    }
    let persistence = Promise.resolve();
    authProvider.on(authProvider.onRefresh, (id, refreshed) => {
      tokenByUserId.set(id, { ...refreshed, userId: id });
      const fullPath = resolve(tokenPath);
      const tempPath = `${fullPath}.${process.pid}.tmp`;
      persistence = persistence.then(async () => {
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(
          tempPath,
          JSON.stringify([...tokenByUserId.values()], null, 2),
          { mode: 0o600 },
        );
        await rename(tempPath, fullPath);
      });
      void persistence.catch(() =>
        console.error("Unable to persist refreshed Twitch tokens."),
      );
    });
    const apiClient = new ApiClient({ authProvider });
    const listener = new EventSubWsListener({ apiClient });
    const channelUsers = new Map<string, string>();
    for (const login of channelLogins) {
      const channel = await apiClient.users.getUserByName(login);
      if (!channel) {
        console.error(
          `Configured channel not found (login fingerprint ${fingerprint(login.toLowerCase())}).`,
        );
        continue;
      }
      if (!authProvider.hasUser(channel.id)) {
        console.error(
          `No authorized token for channel ${fingerprint(channel.id)}.`,
        );
        continue;
      }
      if (
        !authProvider
          .getCurrentScopesForUser(channel.id)
          .includes("user:read:chat")
      ) {
        console.error(
          `Chat scope missing for channel ${fingerprint(channel.id)}.`,
        );
        continue;
      }
      channelUsers.set(channel.id, login);
      listener.onChannelChatMessage(channel.id, channel.id, (event) => {
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
    if (channelUsers.size === 0)
      throw new Error(
        "No configured channel has a matching broadcaster token.",
      );
    listener.start();
    console.log(
      `Loaded ${tokenByUserId.size} Twitch account tokens. Waiting for chat and outgoing raids.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Twitch smoke setup failed",
    );
    process.exitCode = 1;
  }
}
