# Raid Relay

Raid Relay turns the first minute after a Twitch raid into a shared story and vote. Raiders receive a short recap, join the incoming party, and help the destination channel decide what happens next.

> The deterministic engine, naming flow, SQLite persistence, raid handoff, Twitch EventSub adapters, Fastify API, WebSocket updates, overlay, dashboard, recap fallback, optional NVIDIA recap, and public story chain are implemented. Live Twitch delivery and NVIDIA inference still require authorized credentials and verification.

## Requirements

- Node.js 20 or newer and pnpm
- A Twitch developer application for live Twitch checks

## Setup

```sh
pnpm install
cp .env.example .env
```

Fill in `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `CHANNELS` in `.env`. Register the exact `TWITCH_REDIRECT_URI` in the Twitch developer console. Authorize each configured broadcaster separately by running `pnpm twitch:auth` once while signed into each broadcaster account; the script stores all accounts in `.data/twitch-tokens.json`. Then run the EventSub smoke listener:

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

Replace each placeholder with the exact `.env` value; do not include the `<` or `>` characters used to mark placeholders.

The dashboard controls quests and the overlay receives an initial snapshot plus live updates over WebSocket. With `DEMO_MODE=true` and two configured channels, the dashboard exposes **Run full demo**. That button runs a simulated A-to-B scenario through the same event bus and persisted database; the overlay labels simulated inputs.

An active quest can be ended from its dashboard with **Abandon quest**. This records an `ABANDONED` terminal state in the story chain and frees its channel for another quest or the demo. The demo requires both configured channels to have no active quest.

The development server uses `PUBLIC_BASE_URL` for allowed API CORS origins. Vite proxies API and WebSocket requests to the local server. The interactive demo pauses at naming review, votes, raid welcome, beat-two voting, and the outcome so each card has time to appear; its short vote window is configurable with `DEMO_VOTE_WINDOW_SECONDS`.

Recaps use the deterministic two-sentence template by default. To opt into NVIDIA, set `AI_ENABLED=true`, provide `NVIDIA_API_KEY`, and set `AI_MODEL` (the example uses `nvidia/nemotron-3.5-bolt-e4b`). The server sends quest facts only; validated provider failures keep the template recap.

## Project status

Phases 0–6 provide the deterministic engine, SQLite persistence, naming moderation, raid handoff, live EventSub adapters, local HTTP/WebSocket app, overlay, dashboard, recap provider, and a read-only persisted story timeline. Live Twitch and NVIDIA calls still need authorized end-to-end verification. See [docs/TWITCH_NOTES.md](docs/TWITCH_NOTES.md), [docs/DECISIONS.md](docs/DECISIONS.md), and [docs/CODEX_LOG.md](docs/CODEX_LOG.md).

Run the current scripted A-to-B scenario with:

```sh
pnpm demo
```

It prints the persisted quest result and chain events from an in-memory SQLite database. The scenario is marked simulated and does not connect to Twitch.

## Limitations

Twitch's raid event reports a raid viewer count, not the identity of every raider. Incoming-party attribution will therefore be based on observed source-channel participation or an explicit `!join` in the receiving channel; it cannot identify all raiders reliably.

For a quest, the Incoming party is the source-channel cohort: accounts seen proposing a name, voting, or using `!join` in the source channel, plus accounts that use `!join` in the target channel during welcome or beat-2 voting. Other voters are Locals. This is an observed cohort rule and cannot prove which viewers arrived in the raid.
