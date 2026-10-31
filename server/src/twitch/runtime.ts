import { createHmac } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ApiClient } from "@twurple/api";
import { RefreshingAuthProvider, type AccessToken } from "@twurple/auth";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import type { QuestRepository } from "../store/quest-repository.js";
import type { RelayEventBus } from "../events/event-bus.js";
import { normalizeChatFixture, normalizeRaidFixture } from "./normalizers.js";

export interface TwitchHealth {
  status: "disabled" | "connecting" | "connected" | "disconnected" | "error";
  lastChatAt: number | null;
  lastRaidAt: number | null;
  detail: string | null;
}

export interface TwitchRuntimeConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  tokenFile: string;
  channels: string[];
  voterHashSalt: string;
}

type TokenFile = Partial<AccessToken> & {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

export function normalizeTwitchToken(value: TokenFile): AccessToken {
  return {
    accessToken: value.accessToken ?? value.access_token ?? "",
    refreshToken: value.refreshToken ?? value.refresh_token ?? null,
    expiresIn: value.expiresIn ?? value.expires_in ?? null,
    obtainmentTimestamp: value.obtainmentTimestamp ?? Date.now(),
    scope: value.scope ?? [],
  };
}

export function createVoterHash(userId: string, salt: string): string {
  return createHmac("sha256", salt).update(userId).digest("hex");
}

export class TwitchRuntime {
  readonly health: TwitchHealth = {
    status: "disabled",
    lastChatAt: null,
    lastRaidAt: null,
    detail: null,
  };
  private listener: EventSubWsListener | null = null;
  private authProvider: RefreshingAuthProvider | null = null;

  constructor(
    private readonly config: TwitchRuntimeConfig,
    private readonly bus: RelayEventBus,
    private readonly repository: QuestRepository,
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    this.health.status = "connecting";
    if (!this.config.clientId || !this.config.clientSecret) {
      this.fail("Twitch credentials are not configured.");
      return;
    }
    if (
      this.config.voterHashSalt.length < 16 ||
      this.config.voterHashSalt === "change-me"
    ) {
      this.fail(
        "Configure a private voter hash salt of at least 16 characters.",
      );
      return;
    }
    try {
      const tokenPath = resolve(this.config.tokenFile);
      const stored = JSON.parse(await readFile(tokenPath, "utf8")) as TokenFile;
      const token = normalizeTwitchToken(stored);
      if (!token.accessToken || !token.refreshToken)
        throw new Error("Token file is missing access or refresh token.");
      const auth = new RefreshingAuthProvider({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });
      this.authProvider = auth;
      const persist = async (_userId: string, refreshed: AccessToken) => {
        await mkdir(dirname(tokenPath), { recursive: true });
        await writeFile(tokenPath, JSON.stringify(refreshed, null, 2), {
          mode: 0o600,
        });
      };
      auth.on(auth.onRefresh, persist);
      auth.on(auth.onRefreshFailure, (...args) => {
        void args;
        this.fail("Twitch token refresh failed.");
      });
      const userId = await auth.addUserForToken(token);
      if (!auth.getCurrentScopesForUser(userId).includes("user:read:chat"))
        throw new Error("Twitch token lacks user:read:chat scope.");
      const apiClient = new ApiClient({ authProvider: auth });
      const operatorId = userId;
      const channelMap = new Map<string, string>();
      for (const login of this.config.channels) {
        const user = await apiClient.users.getUserByName(login);
        if (!user)
          throw new Error(
            `Configured Twitch channel could not be resolved: ${login}`,
          );
        channelMap.set(user.id, login);
      }
      const listener = new EventSubWsListener({ apiClient });
      this.listener = listener;
      listener.on(listener.onUserSocketConnect, (id) => {
        if (id === operatorId) {
          this.health.status = "connected";
          this.health.detail = null;
        }
      });
      listener.on(listener.onUserSocketDisconnect, (id) => {
        if (id === operatorId && this.health.status !== "error")
          this.health.status = "disconnected";
      });
      listener.on(listener.onSubscriptionCreateFailure, (...args) => {
        void args;
        this.health.status = "error";
        this.health.detail = "A Twitch EventSub subscription was rejected.";
      });
      for (const [broadcasterId, channelId] of channelMap) {
        listener.onChannelChatMessage(broadcasterId, operatorId, (event) => {
          const now = Date.now();
          const message = normalizeChatFixture({
            message_id: event.messageId,
            broadcaster_user_id: event.broadcasterId,
            chatter_user_id: event.chatterId,
            message: { text: event.messageText },
          });
          this.health.lastChatAt = now;
          this.repository.runIdempotent(
            `twitch:chat:${message.eventId}`,
            now,
            () =>
              this.bus.dispatch(
                {
                  type: "chat.message",
                  message: {
                    channelId,
                    voterHash: createVoterHash(
                      message.chatterId,
                      this.config.voterHashSalt,
                    ),
                    text: message.text,
                    source: "twitch",
                  },
                },
                now,
              ),
          );
        });
        listener.onChannelRaidFrom(broadcasterId, (event) => {
          const now = Date.now();
          const raid = normalizeRaidFixture({
            from_broadcaster_user_id: event.raidingBroadcasterId,
            to_broadcaster_user_id: event.raidedBroadcasterId,
            viewers: event.viewers,
          });
          this.health.lastRaidAt = now;
          const sourceChannelId = channelMap.get(raid.sourceBroadcasterId);
          const targetChannelId = channelMap.get(raid.targetBroadcasterId);
          if (!sourceChannelId || !targetChannelId) return;
          const key = `twitch:raid:${sourceChannelId}:${targetChannelId}:${raid.viewers}`;
          this.repository.runIdempotentWithin(key, now, 120_000, () =>
            this.bus.dispatch(
              {
                type: "raid.received",
                raid: {
                  eventId: `${key}:${now}`,
                  sourceChannelId,
                  targetChannelId,
                  viewers: raid.viewers,
                  source: "twitch",
                },
              },
              now,
            ),
          );
        });
      }
      listener.start();
    } catch {
      this.fail("Twitch setup failed; check local server configuration.");
    }
  }

  stop(): void {
    this.listener?.stop();
    this.listener = null;
    if (this.health.status !== "error") this.health.status = "disconnected";
  }

  private fail(detail: string): void {
    this.health.status = "error";
    this.health.detail = detail;
  }
}
