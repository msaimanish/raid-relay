import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { openDatabase } from "../store/database.js";
import { runDemoScenario } from "../demo/scenario.js";
import { createRelayServer, type RelayServer } from "./server.js";

const config = {
  port: 0,
  publicBaseUrl: "http://localhost:3000",
  databasePath: ":memory:",
  dashboardToken: "test-dashboard-secret",
  overlayKey: "test-overlay-secret",
  channels: ["channel-a", "channel-b"],
  namingWindowSeconds: 45,
  voteWindowSeconds: 45,
  welcomeHoldSeconds: 12,
  demoMode: false,
  rateLimitMax: 20,
};

describe("HTTP and realtime server", () => {
  let relay: RelayServer;
  let database: ReturnType<typeof openDatabase>;

  beforeEach(async () => {
    database = openDatabase(":memory:");
    relay = await createRelayServer(config, database);
  });

  afterEach(async () => {
    await relay.close();
    database.close();
  });

  it("protects dashboard actions and returns a safe overlay snapshot", async () => {
    const health = await relay.app.inject({ method: "GET", url: "/healthz" });
    expect(health.json().twitch.status).toBe("disabled");

    const denied = await relay.app.inject({
      method: "POST",
      url: "/api/quests",
      payload: { channelId: "channel-a" },
    });
    expect(denied.statusCode).toBe(401);

    const created = await relay.app.inject({
      method: "POST",
      url: "/api/quests",
      headers: { "x-dashboard-token": config.dashboardToken },
      payload: { channelId: "channel-a" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["x-content-type-options"]).toBe("nosniff");
    const questId = (created.json() as { id: string }).id;
    const internalState = relay.repository.get(questId);
    if (!internalState)
      throw new Error("Created quest missing from repository.");
    relay.repository.save({
      ...internalState,
      status: "NAME_PENDING_APPROVAL",
      pendingName: "Secret Candidate",
    });

    const overlay = await relay.app.inject({
      method: "GET",
      url: "/api/overlay/channel-a",
      headers: { "x-overlay-key": config.overlayKey },
    });
    expect(overlay.statusCode).toBe(200);
    expect(
      (overlay.json() as { state: { pendingName: string | null } }).state
        .pendingName,
    ).toBeNull();
    expect(overlay.body).not.toContain("Secret Candidate");

    const chain = await relay.app.inject({
      method: "GET",
      url: `/api/chain/${questId}`,
    });
    expect(chain.statusCode).toBe(200);
    expect(chain.body).not.toContain("voterHash");
    expect(chain.body).not.toContain("Secret Candidate");
  });

  it("limits REST requests", async () => {
    await relay.close();
    const limited = await createRelayServer(
      { ...config, rateLimitMax: 2 },
      database,
    );
    relay = limited;
    const first = await limited.app.inject({ method: "GET", url: "/healthz" });
    const second = await limited.app.inject({ method: "GET", url: "/healthz" });
    const third = await limited.app.inject({ method: "GET", url: "/healthz" });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });

  it("abandons a paused quest through the authenticated dashboard action", async () => {
    const created = await relay.app.inject({
      method: "POST",
      url: "/api/quests",
      headers: { "x-dashboard-token": config.dashboardToken },
      payload: { channelId: "channel-a" },
    });
    const questId = (created.json() as { id: string }).id;
    await relay.app.inject({
      method: "POST",
      url: "/api/pause",
      headers: { "x-dashboard-token": config.dashboardToken },
      payload: { questId },
    });
    const abandoned = await relay.app.inject({
      method: "POST",
      url: "/api/abandon",
      headers: { "x-dashboard-token": config.dashboardToken },
      payload: { questId },
    });
    expect(abandoned.statusCode).toBe(200);
    expect(relay.repository.get(questId)?.status).toBe("ABANDONED");
    expect(relay.repository.findActiveQuestByChannel("channel-a")).toBeNull();
  });

  it("serves the persisted demo story to the overlay and public chain", async () => {
    const demo = runDemoScenario(database, {
      questId: "demo-http-integration",
      sourceChannelId: "channel-a",
      targetChannelId: "channel-b",
      startTime: Date.now() - 10_000,
    });
    const overlay = await relay.app.inject({
      method: "GET",
      url: "/api/overlay/channel-b",
      headers: { "x-overlay-key": config.overlayKey },
    });
    expect(overlay.statusCode).toBe(200);
    expect(overlay.json()).toMatchObject({
      state: { id: demo.questId, status: "COMPLETED", partySize: 37 },
      simulated: true,
    });

    const chain = await relay.app.inject({
      method: "GET",
      url: `/api/chain/${demo.questId}`,
    });
    expect(chain.statusCode).toBe(200);
    expect(chain.json()).toMatchObject({
      questId: demo.questId,
      status: "COMPLETED",
      sourceChannelId: "channel-a",
      targetChannelId: "channel-b",
      partySize: 37,
      partyTier: "medium",
    });
    expect(chain.body).not.toContain("voterHash");
  });

  it("returns an HTTP 401 for an invalid WebSocket dashboard key", async () => {
    await relay.app.listen({ port: 0, host: "127.0.0.1" });
    const address = relay.app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Server did not bind a TCP port.");
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?channel=channel-a&role=dashboard&key=wrong`,
    );
    const statusCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WebSocket rejection timed out")),
        2_000,
      );
      socket.once("unexpected-response", (_request, response) => {
        clearTimeout(timeout);
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      socket.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    expect(statusCode).toBe(401);
    socket.terminate();
  });

  it("sends an initial WebSocket snapshot and an update after a quest starts", async () => {
    await relay.app.listen({ port: 0, host: "127.0.0.1" });
    const address = relay.app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Server did not bind a TCP port.");
    const socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws?channel=channel-a&role=dashboard&key=${config.dashboardToken}`,
    );
    const readMessage = () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("WebSocket message timed out")),
          2_000,
        );
        socket.once("message", (message) => {
          clearTimeout(timeout);
          resolve(JSON.parse(String(message)) as Record<string, unknown>);
        });
      });
    try {
      const initial = await readMessage();
      expect(initial.type).toBe("snapshot");
      const initialData = initial.data as { state: unknown };
      expect(initialData.state).toBeNull();

      const response = await relay.app.inject({
        method: "POST",
        url: "/api/quests",
        headers: { "x-dashboard-token": config.dashboardToken },
        payload: { channelId: "channel-a" },
      });
      expect(response.statusCode).toBe(201);
      const update = await readMessage();
      expect(update.type).toBe("update");
      expect((update.data as { state: { status: string } }).state.status).toBe(
        "DRAFT",
      );
      socket.close();

      const reconnect = new WebSocket(
        `ws://127.0.0.1:${address.port}/ws?channel=channel-a&role=dashboard&key=${config.dashboardToken}`,
      );
      try {
        const restored = await new Promise<Record<string, unknown>>(
          (resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error("Reconnect snapshot timed out")),
              2_000,
            );
            reconnect.once("message", (message) => {
              clearTimeout(timeout);
              resolve(JSON.parse(String(message)) as Record<string, unknown>);
            });
          },
        );
        expect(restored.type).toBe("snapshot");
        expect(
          (restored.data as { state: { status: string } }).state.status,
        ).toBe("DRAFT");
      } finally {
        reconnect.close();
      }
    } finally {
      socket.close();
    }
  });
});
