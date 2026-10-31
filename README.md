# Raid Relay

Raid Relay turns the first minute after a Twitch raid into a shared story and vote. Raiders receive a short recap, join the incoming party, and help the destination channel decide what happens next.

> The deterministic engine, naming flow, SQLite persistence, raid handoff, and scripted two-channel scenario are implemented. The overlay, dashboard, realtime server, and live Twitch adapter are added in later phases.

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

## Project status

This project is being built in phases. The planned architecture is a deterministic TypeScript game engine, SQLite persistence, a Twitch EventSub adapter, a realtime overlay/dashboard, and a public read-only story chain. See [docs/DECISIONS.md](docs/DECISIONS.md) and [docs/CODEX_LOG.md](docs/CODEX_LOG.md).

Run the current scripted A-to-B scenario with:

```sh
pnpm demo
```

It prints the persisted quest result and chain events from an in-memory SQLite database. The scenario is marked simulated and does not connect to Twitch.

## Limitations

Twitch's raid event reports a raid viewer count, not the identity of every raider. Incoming-party attribution will therefore be based on observed source-channel participation or an explicit `!join` in the receiving channel; it cannot identify all raiders reliably.

For a quest, the Incoming party is the source-channel cohort: accounts seen proposing a name, voting, or using `!join` in the source channel, plus accounts that use `!join` in the target channel during welcome or beat-2 voting. Other voters are Locals. This is an observed cohort rule and cannot prove which viewers arrived in the raid.
