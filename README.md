# Raid Relay

Raid Relay turns the first minute after a Twitch raid into a shared story and vote. Raiders receive a short recap, join the incoming party, and help the destination channel decide what happens next.

> The deterministic engine, naming flow, SQLite persistence, raid handoff, Fastify API, WebSocket updates, overlay, and dashboard are implemented. Live Twitch adapters and the NVIDIA recap are later phases.

## Requirements

- Node.js 20 or newer and pnpm
- A Twitch developer application for live Twitch checks

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `CHANNELS` in `.env`. Register the exact `TWITCH_REDIRECT_URI` in the Twitch developer console. Then authorize and start the EventSub smoke listener:

```sh
pnpm twitch:auth
pnpm twitch:smoke
```

The smoke listener prints hashed account/channel identifiers and raid viewer counts. It never prints chat text or raw user identifiers. Chat subscriptions require `user:read:chat`; see [docs/TWITCH_NOTES.md](docs/TWITCH_NOTES.md) for authorization constraints. A real chat message and an actual raid are required to verify live delivery.

## Run the app

Set `CHANNELS` to two Twitch logins and choose private `DASHBOARD_TOKEN` and `OVERLAY_KEY` values in `.env`. Start the API and Vite UI:

```sh
pnpm dev
```

Open the dashboard and overlay in a browser (use the configured channel login):

```text
http://localhost:5173/dashboard/channel_a_login?token=YOUR_DASHBOARD_TOKEN&overlayKey=YOUR_OVERLAY_KEY
http://localhost:5173/overlay/channel_a_login?key=YOUR_OVERLAY_KEY
```

The dashboard controls quests and the overlay receives an initial snapshot plus live updates over WebSocket. With `DEMO_MODE=true` and two configured channels, the dashboard exposes **Run full demo**. That button runs a simulated A-to-B scenario through the same event bus and persisted database; the overlay labels simulated inputs.

The development server uses `PUBLIC_BASE_URL` for allowed API CORS origins. Vite proxies API and WebSocket requests to the local server. The interactive demo pauses at naming review, votes, raid welcome, beat-two voting, and the outcome so each card has time to appear; its short vote window is configurable with `DEMO_VOTE_WINDOW_SECONDS`.

## Project status

Phases 0–4 provide the deterministic engine, SQLite persistence, naming moderation, raid-handoff event path, local HTTP/WebSocket app, overlay, dashboard, and a read-only persisted story timeline. Real Twitch chat/raid delivery is not integrated yet; connection health remains `not_connected` until Phase 5. See [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/CODEX_LOG.md](docs/CODEX_LOG.md).

Run the current scripted A-to-B scenario with:

```sh
pnpm demo
```

It prints the persisted quest result and chain events from an in-memory SQLite database. The scenario is marked simulated and does not connect to Twitch.

## Limitations

Twitch's raid event reports a raid viewer count, not the identity of every raider. Incoming-party attribution will therefore be based on observed source-channel participation or an explicit `!join` in the receiving channel; it cannot identify all raiders reliably.

For a quest, the Incoming party is the source-channel cohort: accounts seen proposing a name, voting, or using `!join` in the source channel, plus accounts that use `!join` in the target channel during welcome or beat-2 voting. Other voters are Locals. This is an observed cohort rule and cannot prove which viewers arrived in the raid.
