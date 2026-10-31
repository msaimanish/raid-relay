import { once } from "node:events";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "@twurple/api";
import { StaticAuthProvider } from "@twurple/auth";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import { WebSocketServer } from "ws";

describe("Twurple EventSub reconnect", () => {
  let listener: EventSubWsListener | undefined;
  let server: WebSocketServer | undefined;

  afterEach(async () => {
    listener?.stop();
    listener = undefined;
    if (server) {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("follows session_reconnect to the replacement WebSocket URL", async () => {
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const replacementUrl = `ws://127.0.0.1:${port}/replacement`;
    let connectionCount = 0;
    let replacementConnected!: () => void;
    const replacement = new Promise<void>((resolve) => {
      replacementConnected = resolve;
    });
    server.on("connection", (socket) => {
      connectionCount += 1;
      if (connectionCount === 1) {
        socket.send(
          JSON.stringify({
            metadata: { message_type: "session_reconnect" },
            payload: { session: { reconnect_url: replacementUrl } },
          }),
        );
      } else {
        socket.send(
          JSON.stringify({
            metadata: { message_type: "session_welcome" },
            payload: {
              session: { id: "fixture-session", keepalive_timeout_seconds: 30 },
            },
          }),
        );
        replacementConnected();
      }
    });

    const authProvider = new StaticAuthProvider(
      "fixture-client",
      "fixture-token",
      ["user:read:chat"],
    );
    const apiClient = new ApiClient({ authProvider });
    listener = new EventSubWsListener({
      apiClient,
      url: `ws://127.0.0.1:${port}/initial`,
    });
    listener.onChannelChatMessage("1001", "2002", () => {});
    listener.start();
    await Promise.race([
      replacement,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("reconnect timed out")), 3000),
      ),
    ]);
    expect(connectionCount).toBe(2);
  });
});
