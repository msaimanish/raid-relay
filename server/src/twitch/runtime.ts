import { createHmac } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
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

export type TokenFile = Partial<AccessToken> & {
  userId?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
};

export function parseTwitchTokenFile(value: unknown): TokenFile[] {
  const entries = Array.isArray(value) ? value : [value];
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        typeof entry !== "object" || entry === null || Array.isArray(entry),
    )
  ) {
    throw new Error(
      "Twitch token file must contain one or more token objects.",
    );
  }
  return entries as TokenFile[];
}

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
  private tokensByUserId = new Map<string, AccessToken & { userId: string }>();
  private refreshVersions = new Map<string, number>();

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
      const stored = parseTwitchTokenFile(
        JSON.parse(await readFile(tokenPath, "utf8")) as unknown,
      );
      const auth = new RefreshingAuthProvider({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      });
      this.authProvider = auth;
      let tokensLoaded = false;
      let refreshPending = false;
      const queuePersistence = () => {
        const temporaryPath = `${tokenPath}.${process.pid}.tmp`;
        this.persistQueue = this.persistQueue
          .catch(() => undefined)
          .then(async () => {
            await mkdir(dirname(tokenPath), { recursive: true });
            await writeFile(
              temporaryPath,
              JSON.stringify([...this.tokensByUserId.values()], null, 2),
              { mode: 0o600 },
            );
            await rename(temporaryPath, tokenPath);
          });
        void this.persistQueue.catch(() =>
          this.fail("Unable to save refreshed Twitch tokens."),
        );
      };
      const persist = (userId: string, refreshed: AccessToken) => {
        this.tokensByUserId.set(userId, { ...refreshed, userId });
        this.refreshVersions.set(
          userId,
          (this.refreshVersions.get(userId) ?? 0) + 1,
        );
        refreshPending = true;
        if (tokensLoaded) queuePersistence();
      };
      auth.on(auth.onRefresh, persist);
      auth.on(auth.onRefreshFailure, (...args) => {
        void args;
        this.fail("Twitch token refresh failed.");
      });
      for (const storedToken of stored) {
        const token = normalizeTwitchToken(storedToken);
        if (!token.accessToken || !token.refreshToken)
          throw new Error(
            "A Twitch token is missing its access or refresh token.",
          );
        const versionsBeforeAdd = new Map(this.refreshVersions);
        const userId = await auth.addUserForToken(token);
        if (
          (this.refreshVersions.get(userId) ?? 0) ===
          (versionsBeforeAdd.get(userId) ?? 0)
        ) {
          this.tokensByUserId.set(userId, { ...token, userId });
        }
      }
      tokensLoaded = true;
      if (refreshPending) queuePersistence();
      if (this.tokensByUserId.size === 0)
        throw new Error("No Twitch user tokens were loaded.");
      const apiClient = new ApiClient({ authProvider: auth });
      const channelMap = new Map<string, string>();
      for (const login of this.config.channels) {
        const user = await apiClient.users.getUserByName(login);
        if (!user)
          throw new Error(
            `Configured Twitch channel could not be resolved: ${login}`,
          );
        if (!auth.hasUser(user.id))
          throw new Error(
            `No Twitch user token is loaded for channel ${login}.`,
          );
        if (!auth.getCurrentScopesForUser(user.id).includes("user:read:chat"))
          throw new Error(
            `Twitch token for channel ${login} lacks user:read:chat scope.`,
          );
        channelMap.set(user.id, login);
      }
      const listener = new EventSubWsListener({ apiClient });
      this.listener = listener;
      const connectedUserIds = new Set<string>();
      listener.on(listener.onUserSocketConnect, (id) => {
        if (channelMap.has(id)) connectedUserIds.add(id);
        if (connectedUserIds.size === channelMap.size) {
          this.health.status = "connected";
          this.health.detail = null;
        }
      });
      listener.on(listener.onUserSocketDisconnect, (id) => {
        connectedUserIds.delete(id);
        if (channelMap.has(id) && this.health.status !== "error")
          this.health.status = "disconnected";
      });
      listener.on(listener.onSubscriptionCreateFailure, (...args) => {
        void args;
        this.health.status = "error";
        this.health.detail = "A Twitch EventSub subscription was rejected.";
      });
      for (const [broadcasterId, channelId] of channelMap) {
        // Twurple uses the second argument as this subscription's auth context.
        // Use the broadcaster's own loaded token for chat and outgoing raids.
        listener.onChannelChatMessage(broadcasterId, broadcasterId, (event) => {
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
      this.fail("Twitch setup failed; check token and channel configuration.");
    }
  }

  private persistQueue: Promise<void> = Promise.resolve();

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
