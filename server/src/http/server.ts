import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Duplex } from "node:stream";
import { dirname, resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";
import {
  createInitialQuestState,
  type QuestState,
} from "../../../shared/src/index.js";
import { RelayEventBus } from "../events/event-bus.js";
import { playDemo } from "../demo/playback.js";
import { openDatabase, type RelayDatabase } from "../store/database.js";
import {
  QuestRepository,
  type StoredQuestEvent,
} from "../store/quest-repository.js";
import { TwitchRuntime, type TwitchHealth } from "../twitch/runtime.js";
import { NemotronRecapProvider } from "../recap/provider.js";
import { RecapService } from "../recap/service.js";
import { resolveProjectPath } from "../config/project-paths.js";

export interface RelayServerConfig {
  port: number;
  publicBaseUrl: string;
  databasePath: string;
  dashboardToken: string;
  overlayKey: string;
  channels: string[];
  namingWindowSeconds: number;
  voteWindowSeconds: number;
  welcomeHoldSeconds: number;
  demoVoteWindowSeconds?: number;
  demoMode: boolean;
  rateLimitMax?: number;
  twitchClientId?: string;
  twitchClientSecret?: string;
  twitchTokenFile?: string;
  voterHashSalt?: string;
  aiEnabled?: boolean;
  nvidiaApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  aiTimeoutMs?: number;
}

export function loadServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): RelayServerConfig {
  const positiveSeconds = (key: string, fallback: number): number => {
    const value = Number(env[key] ?? fallback);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  return {
    port: positiveSeconds("PORT", 3000),
    publicBaseUrl: env.PUBLIC_BASE_URL ?? "http://localhost:3000",
    databasePath: resolveProjectPath(
      env.DATABASE_PATH ?? "./.data/raid-relay.db",
    ),
    dashboardToken: env.DASHBOARD_TOKEN ?? "change-me",
    overlayKey: env.OVERLAY_KEY ?? "change-me",
    channels: (env.CHANNELS ?? "channel_a_login,channel_b_login")
      .split(",")
      .map((channel) => channel.trim().toLowerCase())
      .filter(Boolean),
    namingWindowSeconds: positiveSeconds("NAMING_WINDOW_SECONDS", 45),
    voteWindowSeconds: positiveSeconds("VOTE_WINDOW_SECONDS", 45),
    welcomeHoldSeconds: positiveSeconds("WELCOME_HOLD_SECONDS", 12),
    demoVoteWindowSeconds: positiveSeconds("DEMO_VOTE_WINDOW_SECONDS", 6),
    demoMode: env.DEMO_MODE === "true",
    rateLimitMax: positiveSeconds("REST_RATE_LIMIT_MAX", 120),
    ...(env.TWITCH_CLIENT_ID ? { twitchClientId: env.TWITCH_CLIENT_ID } : {}),
    ...(env.TWITCH_CLIENT_SECRET
      ? { twitchClientSecret: env.TWITCH_CLIENT_SECRET }
      : {}),
    twitchTokenFile: resolveProjectPath(
      env.TWITCH_TOKEN_FILE ?? "./.data/twitch-tokens.json",
    ),
    voterHashSalt: env.VOTER_HASH_SALT ?? "change-me",
    aiEnabled: env.AI_ENABLED === "true",
    ...(env.NVIDIA_API_KEY ? { nvidiaApiKey: env.NVIDIA_API_KEY } : {}),
    aiBaseUrl: env.AI_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
    aiModel: env.AI_MODEL?.trim() || "nvidia/nemotron-3.5-bolt-e4b",
    aiTimeoutMs: positiveSeconds("AI_TIMEOUT_MS", 8000),
  };
}

const StartQuestSchema = z.object({ channelId: z.string().min(1).max(128) });
const QuestIdSchema = z.object({ questId: z.string().min(1).max(128) });
const ActionSchema = z.object({ questId: z.string().min(1).max(128) });

const PUBLIC_EVENT_TYPES = new Set([
  "naming.opened",
  "name.pending_approval",
  "name.approved",
  "name.rejected",
  "name.default_selected",
  "beat1.voting_opened",
  "beat1.resolved",
  "raid.received",
  "handoff.accepted",
  "handoff.dismissed",
  "beat2.voting_opened",
  "beat2.resolved",
  "quest.paused",
  "quest.resumed",
  "quest.started",
  "quest.abandoned",
]);

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicEvents(events: StoredQuestEvent[]) {
  return events.filter((event) => PUBLIC_EVENT_TYPES.has(event.type));
}

function hasSimulatedCurrentInput(
  state: QuestState,
  events: StoredQuestEvent[],
): boolean {
  if (
    state.status === "NAMING_OPEN" ||
    state.status === "NAME_PENDING_APPROVAL"
  ) {
    return events.some(
      (event) =>
        event.type === "demo.input" && event.data.commandType === "name",
    );
  }
  const round =
    state.status === "BEAT1_VOTING" || state.status === "AWAITING_RAID"
      ? 1
      : state.status === "HANDOFF_OFFERED" ||
          state.status === "WELCOME" ||
          state.status === "BEAT2_VOTING" ||
          state.status === "COMPLETED" ||
          state.status === "HANDOFF_DISMISSED"
        ? 2
        : null;
  if (round === null) return false;
  return events.some(
    (event) =>
      (event.type === "demo.input" && event.data.round === round) ||
      ((state.status === "HANDOFF_OFFERED" ||
        state.status === "WELCOME" ||
        state.status === "HANDOFF_DISMISSED") &&
        event.type === "raid.received" &&
        event.data.source === "demo"),
  );
}

function voteTallies(repository: QuestRepository, state: QuestState) {
  const round = state.status === "BEAT1_VOTING" ? 1 : 2;
  const votes = repository.votes(state.id, round);
  const result: Record<string, { raider: number; local: number }> = {};
  for (const vote of votes) {
    result[vote.choice] ??= { raider: 0, local: 0 };
    result[vote.choice]![vote.faction] += 1;
  }
  const raider = votes.filter((vote) => vote.faction === "raider").length;
  const local = votes.length - raider;
  return { round, votes: votes.length, raider, local, choices: result };
}

function createSnapshot(
  repository: QuestRepository,
  channelId: string,
  role: "overlay" | "dashboard",
  config: RelayServerConfig,
  twitchHealth: TwitchHealth,
  recapService: RecapService,
) {
  const state = repository.findLatestQuestByChannel(channelId);
  if (!state) {
    const emptySnapshot: Record<string, unknown> = {
      channelId,
      state: null,
      simulated: false,
      demoMode: config.demoMode,
    };
    if (role === "dashboard") emptySnapshot.twitch = { ...twitchHealth };
    return emptySnapshot;
  }
  const visibleState =
    role === "overlay" ? { ...state, pendingName: null } : state;
  const events = repository.events(state.id);
  const snapshot: Record<string, unknown> = {
    channelId,
    state: visibleState,
    channelDisplayName: state.currentChannelId,
    sourceDisplayName: state.sourceChannelId,
    tallies: voteTallies(repository, state),
    simulated: hasSimulatedCurrentInput(state, events),
    proposalCount: repository
      .rankNameProposals(state.id)
      .reduce((total, item) => total + item.supportCount, 0),
    welcomeHoldSeconds: config.welcomeHoldSeconds,
    publicBaseUrl: config.publicBaseUrl,
    demoMode: config.demoMode,
  };
  if (state.sourceChannelId !== null) {
    const recap = recapService.get(state.id, state);
    snapshot.recap = { text: recap.text, recap_source: recap.source };
  }
  if (role === "dashboard") {
    snapshot.candidates = repository.rankNameProposals(state.id);
    snapshot.chainEvents = events;
    snapshot.twitch = { ...twitchHealth };
  }
  return snapshot;
}

function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function rejectWebSocketUpgrade(
  socket: Duplex,
  status: 400 | 401 | 404 | 429,
  reason: string,
): void {
  const body = `${reason}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

export interface RelayServer {
  app: FastifyInstance;
  repository: QuestRepository;
  database: RelayDatabase;
  close(): Promise<void>;
}

export async function createRelayServer(
  config = loadServerConfig(),
  suppliedDatabase?: RelayDatabase,
): Promise<RelayServer> {
  const dbPath =
    config.databasePath === ":memory:"
      ? ":memory:"
      : resolve(config.databasePath);
  if (!suppliedDatabase && dbPath !== ":memory:")
    mkdirSync(dirname(dbPath), { recursive: true });
  const database = suppliedDatabase ?? openDatabase(config.databasePath);
  const repository = new QuestRepository(database);
  const channels = config.channels;
  const recapProvider =
    config.aiEnabled && config.nvidiaApiKey && config.aiModel
      ? new NemotronRecapProvider(
          config.nvidiaApiKey,
          config.aiBaseUrl ?? "https://integrate.api.nvidia.com/v1",
          config.aiModel,
          config.aiTimeoutMs ?? 8000,
        )
      : undefined;
  const recapService = new RecapService(repository, recapProvider);
  const bus = new RelayEventBus(repository, channels, (raid, questId) => {
    recapService.onRaid(questId, raid.eventId);
  });
  const twitch = new TwitchRuntime(
    {
      enabled: Boolean(config.twitchClientId && config.twitchClientSecret),
      ...(config.twitchClientId ? { clientId: config.twitchClientId } : {}),
      ...(config.twitchClientSecret
        ? { clientSecret: config.twitchClientSecret }
        : {}),
      tokenFile: config.twitchTokenFile ?? "./.data/twitch-tokens.json",
      channels,
      voterHashSalt: config.voterHashSalt ?? "change-me",
    },
    bus,
    repository,
  );
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: false,
  });
  const webSockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const clients = new Map<
    WebSocket,
    {
      channelId: string;
      role: "overlay" | "dashboard";
      last: string;
      ip: string;
    }
  >();
  const wsAttempts = new Map<string, { startedAt: number; count: number }>();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
        imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
  });
  await app.register(cors, {
    origin: new URL(config.publicBaseUrl).origin,
    credentials: false,
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax ?? 120,
    timeWindow: 10_000,
  });

  for (const login of channels) {
    database
      .prepare(
        "INSERT OR IGNORE INTO channels (id, login, display_name) VALUES (?, ?, ?)",
      )
      .run(login, login, login);
  }

  const requireDashboard = (
    request: { headers: Record<string, unknown>; query?: unknown },
    reply: { code: (status: number) => { send: (value: unknown) => unknown } },
  ): boolean => {
    const queryToken = (request.query as { token?: unknown } | undefined)
      ?.token;
    const headerToken = request.headers["x-dashboard-token"];
    const token =
      typeof headerToken === "string"
        ? headerToken
        : typeof queryToken === "string"
          ? queryToken
          : "";
    if (!constantTimeEqual(token, config.dashboardToken)) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  };

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "internal_error";
    const providedStatus =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : null;
    const status =
      providedStatus ??
      (error instanceof z.ZodError
        ? 400
        : message.includes("does not exist")
          ? 404
          : 409);
    reply.code(status).send({
      error: error instanceof z.ZodError ? "invalid_request" : message,
    });
  });

  app.get("/healthz", async () => ({
    ok: true,
    channels: channels.length,
    twitch: { ...twitch.health },
  }));

  app.get<{ Params: { channel: string } }>(
    "/api/overlay/:channel",
    async (request, reply) => {
      const channel = request.params.channel.toLowerCase();
      const key =
        typeof request.headers["x-overlay-key"] === "string"
          ? request.headers["x-overlay-key"]
          : "";
      if (!constantTimeEqual(key, config.overlayKey))
        return reply.code(401).send({ error: "unauthorized" });
      if (!channels.includes(channel))
        return reply.code(404).send({ error: "unknown_channel" });
      return createSnapshot(
        repository,
        channel,
        "overlay",
        config,
        twitch.health,
        recapService,
      );
    },
  );

  app.get<{ Params: { questId: string } }>(
    "/api/chain/:questId",
    async (request, reply) => {
      const state = repository.get(request.params.questId);
      if (!state) return reply.code(404).send({ error: "not_found" });
      const events = publicEvents(repository.events(state.id));
      return {
        questId: state.id,
        title: state.title,
        objective: state.objective,
        status: state.status,
        sourceChannelId: state.sourceChannelId,
        targetChannelId: state.targetChannelId,
        partySize: state.partySize,
        partyTier: state.partyTier,
        canonName: state.canonName,
        outcome: state.outcome,
        events,
      };
    },
  );

  app.get("/api/chain", async () =>
    repository.all().map((state) => ({
      questId: state.id,
      title: state.title,
      status: state.status,
      channelId: state.currentChannelId,
      sourceChannelId: state.sourceChannelId,
      targetChannelId: state.targetChannelId,
      partySize: state.partySize,
      partyTier: state.partyTier,
      canonName: state.canonName,
      outcome: state.outcome,
      updatedAt: state.updatedAt,
    })),
  );

  app.post("/api/quests", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const { channelId } = StartQuestSchema.parse(request.body);
    if (!channels.includes(channelId.toLowerCase()))
      return reply.code(400).send({ error: "unknown_channel" });
    if (repository.findActiveQuestByChannel(channelId))
      return reply.code(409).send({ error: "active_quest_exists" });
    const now = Date.now();
    const state = createInitialQuestState(
      randomUUID(),
      channelId.toLowerCase(),
      now,
    );
    repository.save(state, [
      {
        type: "quest.started",
        at: now,
        data: { channelId: state.currentChannelId },
      },
    ]);
    return reply.code(201).send(state);
  });

  app.post<{ Params: { questId: string } }>(
    "/api/quests/:questId/naming/open",
    async (request, reply) => {
      if (!requireDashboard(request, reply)) return;
      const { questId } = QuestIdSchema.parse(request.params);
      return bus.dispatch(
        {
          type: "quest.command",
          questId,
          command: {
            type: "OPEN_NAMING",
            deadlineAt: Date.now() + config.namingWindowSeconds * 1000,
          },
        },
        Date.now(),
      );
    },
  );

  app.post<{ Params: { questId: string } }>(
    "/api/quests/:questId/name/approve",
    async (request, reply) => {
      if (!requireDashboard(request, reply)) return;
      const { questId } = QuestIdSchema.parse(request.params);
      return bus.dispatch(
        {
          type: "name.approve",
          questId,
          actorHash: null,
          voteDeadlineAt: Date.now() + config.voteWindowSeconds * 1000,
        },
        Date.now(),
      );
    },
  );

  app.post<{ Params: { questId: string } }>(
    "/api/quests/:questId/name/veto",
    async (request, reply) => {
      if (!requireDashboard(request, reply)) return;
      const { questId } = QuestIdSchema.parse(request.params);
      return bus.dispatch(
        {
          type: "name.veto",
          questId,
          actorHash: null,
          voteDeadlineAt: Date.now() + config.voteWindowSeconds * 1000,
        },
        Date.now(),
      );
    },
  );

  app.post<{ Params: { questId: string } }>(
    "/api/quests/:questId/voting/open",
    async (request, reply) => {
      if (!requireDashboard(request, reply)) return;
      const { questId } = QuestIdSchema.parse(request.params);
      return bus.dispatch(
        {
          type: "quest.command",
          questId,
          command: {
            type: "OPEN_BEAT2_VOTING",
            deadlineAt: Date.now() + config.voteWindowSeconds * 1000,
          },
        },
        Date.now(),
      );
    },
  );

  app.post<{ Params: { questId: string } }>(
    "/api/quests/:questId/voting/close",
    async (request, reply) => {
      if (!requireDashboard(request, reply)) return;
      const { questId } = QuestIdSchema.parse(request.params);
      const state = repository.get(questId);
      if (!state) return reply.code(404).send({ error: "quest_not_found" });
      return bus.dispatch(
        {
          type: "quest.command",
          questId,
          command: { type: "WINDOW_CLOSED", votes: [] },
        },
        Math.max(Date.now(), state.deadlineAt ?? Date.now()),
      );
    },
  );

  app.post("/api/handoff/accept", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const { questId } = ActionSchema.parse(request.body);
    return bus.dispatch(
      { type: "quest.command", questId, command: { type: "ACCEPT_HANDOFF" } },
      Date.now(),
    );
  });
  app.post("/api/handoff/dismiss", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const { questId } = ActionSchema.parse(request.body);
    return bus.dispatch(
      { type: "quest.command", questId, command: { type: "DISMISS_HANDOFF" } },
      Date.now(),
    );
  });
  app.post("/api/pause", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const { questId } = ActionSchema.parse(request.body);
    return bus.dispatch(
      { type: "quest.command", questId, command: { type: "PAUSE" } },
      Date.now(),
    );
  });
  app.post("/api/resume", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const { questId } = ActionSchema.parse(request.body);
    return bus.dispatch(
      { type: "quest.command", questId, command: { type: "RESUME" } },
      Date.now(),
    );
  });
  app.post("/api/abandon", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    const { questId } = ActionSchema.parse(request.body);
    return bus.dispatch(
      { type: "quest.command", questId, command: { type: "ABANDON" } },
      Date.now(),
    );
  });

  app.post("/api/demo/run", async (request, reply) => {
    if (!requireDashboard(request, reply)) return;
    if (!config.demoMode)
      return reply.code(404).send({ error: "demo_disabled" });
    if (channels.length < 2)
      return reply.code(409).send({ error: "two_channels_required" });
    const body =
      request.body === undefined
        ? {}
        : z.object({ channelId: z.string().optional() }).parse(request.body);
    const sourceChannelId = body.channelId?.toLowerCase() ?? channels[0]!;
    const targetChannelId = channels.find((value) => value !== sourceChannelId);
    if (!channels.includes(sourceChannelId) || !targetChannelId)
      return reply.code(400).send({ error: "invalid_demo_channels" });
    if (
      repository.findActiveQuestByChannel(sourceChannelId) ||
      repository.findActiveQuestByChannel(targetChannelId)
    )
      return reply.code(409).send({ error: "active_quest_exists" });
    void playDemo(
      repository,
      bus,
      sourceChannelId,
      targetChannelId,
      config.welcomeHoldSeconds,
      config.demoVoteWindowSeconds ?? 6,
    ).catch((error: unknown) => {
      app.log.error({ err: error }, "interactive demo failed");
    });
    return reply.code(202).send({ status: "started" });
  });

  app.server.on("upgrade", (request, socket, head) => {
    try {
      const url = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
      if (url.pathname !== "/ws")
        return rejectWebSocketUpgrade(socket, 404, "Not Found");
      const channelId = url.searchParams.get("channel")?.toLowerCase() ?? "";
      const role = url.searchParams.get("role");
      const key = url.searchParams.get("key") ?? "";
      if (
        !channels.includes(channelId) ||
        (role !== "overlay" && role !== "dashboard")
      )
        return rejectWebSocketUpgrade(socket, 404, "Not Found");
      const expected =
        role === "dashboard" ? config.dashboardToken : config.overlayKey;
      if (!constantTimeEqual(key, expected))
        return rejectWebSocketUpgrade(socket, 401, "Unauthorized");
      const ip = request.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      const previous = wsAttempts.get(ip);
      const attempt =
        previous && now - previous.startedAt < 10_000
          ? { startedAt: previous.startedAt, count: previous.count + 1 }
          : { startedAt: now, count: 1 };
      wsAttempts.set(ip, attempt);
      const openForIp = [...clients.values()].filter(
        (client) => client.ip === ip,
      ).length;
      if (attempt.count > 30 || openForIp >= 8)
        return rejectWebSocketUpgrade(socket, 429, "Too Many Requests");
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        clients.set(webSocket, { channelId, role, last: "", ip });
        const data = createSnapshot(
          repository,
          channelId,
          role,
          config,
          twitch.health,
          recapService,
        );
        const serialized = JSON.stringify(data);
        clients.set(webSocket, { channelId, role, last: serialized, ip });
        sendJson(webSocket, { type: "snapshot", data });
        webSocket.on("close", () => clients.delete(webSocket));
      });
    } catch {
      rejectWebSocketUpgrade(socket, 400, "Bad Request");
    }
  });

  const broadcast = setInterval(() => {
    for (const [socket, client] of clients) {
      const data = createSnapshot(
        repository,
        client.channelId,
        client.role,
        config,
        twitch.health,
        recapService,
      );
      const serialized = JSON.stringify(data);
      if (serialized !== client.last) {
        const previous = JSON.parse(client.last) as Record<string, unknown>;
        const changed = Object.fromEntries(
          Object.entries(data).filter(
            ([key, value]) =>
              JSON.stringify(previous[key]) !== JSON.stringify(value),
          ),
        );
        sendJson(socket, { type: "update", data: changed });
        clients.set(socket, { ...client, last: serialized });
      }
    }
  }, 500);
  broadcast.unref();

  const scheduler = setInterval(() => {
    const now = Date.now();
    for (const state of repository.all()) {
      if (state.pausedAt !== null) continue;
      if (
        state.status === "WELCOME" &&
        now >= state.updatedAt + config.welcomeHoldSeconds * 1000
      ) {
        try {
          const isDemoQuest = repository
            .events(state.id)
            .some(
              (event) =>
                event.type === "raid.received" && event.data.source === "demo",
            );
          bus.dispatch(
            {
              type: "quest.command",
              questId: state.id,
              command: {
                type: "OPEN_BEAT2_VOTING",
                deadlineAt:
                  now +
                  (isDemoQuest
                    ? (config.demoVoteWindowSeconds ?? 6)
                    : config.voteWindowSeconds) *
                    1000,
              },
            },
            now,
          );
        } catch (error) {
          app.log.warn(
            { err: error, questId: state.id },
            "scheduled welcome transition failed",
          );
        }
        continue;
      }
      if (state.deadlineAt === null || now < state.deadlineAt) continue;
      try {
        if (state.status === "NAMING_OPEN") {
          bus.dispatch(
            {
              type: "name.review",
              questId: state.id,
              voteDeadlineAt: now + config.voteWindowSeconds * 1000,
            },
            now,
          );
        } else if (
          state.status === "BEAT1_VOTING" ||
          state.status === "BEAT2_VOTING"
        ) {
          bus.dispatch(
            {
              type: "quest.command",
              questId: state.id,
              command: { type: "WINDOW_CLOSED", votes: [] },
            },
            now,
          );
        }
      } catch (error) {
        app.log.warn(
          { err: error, questId: state.id },
          "scheduled quest transition failed",
        );
      }
    }
  }, 250);
  scheduler.unref();

  await twitch.start();

  return {
    app,
    repository,
    database,
    async close() {
      clearInterval(broadcast);
      clearInterval(scheduler);
      twitch.stop();
      for (const socket of clients.keys()) socket.close();
      await app.close();
      webSockets.close();
      if (!suppliedDatabase) database.close();
    },
  };
}
