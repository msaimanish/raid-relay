# Devpost submission draft

## Project name

Raid Relay

## Tagline

Turn the first minute of a Twitch raid into a story everyone can shape.

## Inspiration / problem

A raid can bring a whole community into a new chat, but viewers arrive without context and the first minute can feel awkward. Raid Relay gives them an immediate shared activity: carry a story from the source channel into the receiving channel and let both communities decide what happens next.

## What it does

A streamer starts **The Ember Relic** quest. Chat proposes a creature name; the streamer privately approves or vetoes the moderated proposals before canon is revealed. Viewers vote on the first story beat. When a raid is observed, its raw viewer count becomes the party size for the next beat. At the destination, raiders can join the Incoming party, locals vote as a separate faction, and the deterministic engine resolves the outcome. A read-only chain records the public story events.

## How it works

Twitch chat and raid adapters, plus the scripted demo, send normalized inputs through one event bus. A deterministic TypeScript reducer owns state transitions, faction assignment, vote aggregation, and outcomes. Fastify serves REST and WebSocket views backed by SQLite. The streamer dashboard controls the quest; the OBS overlay shows the current story; the chain page reads persisted public events. An optional NVIDIA recap provider receives engine facts only and must pass schema, moderation, and number checks; the template recap remains the fallback.

## What was built with Codex

Codex assisted with repository scaffolding, the deterministic game engine and persistence, moderation and naming approval, the two-channel demo, Twitch adapters, the dashboard and overlay, the recap provider, the public story chain, and automated checks. The implementation record and verification limits are in [docs/CODEX_LOG.md](CODEX_LOG.md). The scripted demo is simulated and clearly labeled; it is not represented as a live Twitch raid.

## Challenges

- Twitch requires the broadcaster's own user token for outgoing raid subscriptions, so a single operator token cannot authorize both channels. The runtime loads a token per broadcaster and persists refreshes to the token array.
- A Vite WebSocket proxy failure initially obscured the backend's environment-loading and upgrade behavior. The server now loads the root `.env`, resolves data paths from the project root, and rejects invalid upgrades explicitly. A development-only React Strict Mode replay was also addressed by deferring the initial WebSocket attempt.
- Raiders cannot be reliably identified from the raid viewer count. The app uses observed source-channel participation and explicit `!join` instead of claiming that every viewer is a raider.
- Keeping the LLM outside game control was a design constraint: only the deterministic engine decides game state, and generated recap text is validated before display.

## What's next

Verify chat delivery, real cross-channel raids and viewer counts, token refresh and recovery against the authorized Twitch accounts. Verify optional NVIDIA inference with a live key. Complete the browser recording walkthrough and continue accessibility and submission review.

## Verification status

The scripted A-to-B demo and its overlay/chain data paths are covered by local tests. Live Twitch delivery and live NVIDIA inference have not been verified for this submission draft. Consult [docs/TWITCH_NOTES.md](TWITCH_NOTES.md) for the outstanding `TODO(verify)` items before making live-integration claims.
