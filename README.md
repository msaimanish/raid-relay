# Raid Relay

Raid Relay turns the first minute after a Twitch raid into a shared story and vote. Raiders receive a short recap, join the incoming party, and help the destination channel decide what happens next.

> Phase 0 scaffold. Product routes and gameplay are added in later phases.

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

## Limitations

Twitch's raid event reports a raid viewer count, not the identity of every raider. Incoming-party attribution will therefore be based on observed source-channel participation or an explicit `!join` in the receiving channel; it cannot identify all raiders reliably.
