# Codex build log

## Phase 0 — Recon, scaffold, guardrails, Twitch smoke test

- Inspected the existing repository and Git history; found only the starter README, LICENSE, and `.gitignore`.
- Added repository guardrails and project scaffolding (strict TypeScript, pnpm workspaces, Vitest, ESLint/Prettier, Vite/React, Fastify/SQLite dependency set), plus OAuth authorization-code and EventSub WebSocket smoke-test scripts.
- Tests added: one scaffold test to ensure Vitest is wired correctly (1 test).
- Bugs found and fixed: corrected an assumed Twurple `getMe` method to use the documented token-info and user lookup APIs; replaced the tsx CLI invocation after it failed to create an IPC socket in this environment.
- Verification: typecheck, lint, one test, and web/server/shared build passed. Both Twitch scripts were invoked and correctly reported missing local credentials. Live chat/raid delivery remains unverified.

## Phase 1 — Engine and persistence

- Added shared Zod schemas, the pure quest reducer, party tiers, equal-faction vote aggregation, static deterministic outcome scoring, SQLite WAL migrations, quest/event/vote/idempotency repositories, and the documented rules table.
- Tests added: 12 engine tests covering lifecycle transitions, invalid commands, vote combination and replacement, tier boundaries, pause/resume, name privacy, all 18 beat-2 combinations, and byte-for-byte deterministic replay; 2 persistence tests covering close/reopen state/history and vote/idempotency behavior.
- Bugs found and fixed: pending and rejected name text was initially present in an engine event; removed candidate text from chain events and added a regression test. Adjusted server TypeScript output layout so shared engine contracts compile into the server build.
- Verification: typecheck, lint, 15 total tests, build, and formatting check passed. Restart test reopens the same SQLite file and compares persisted state and ordered history.

## Phase 2 — Naming, moderation, approval

- Added round-aware chat command parsing, Unicode normalization and candidate moderation, hashed-account proposal replacement, plurality ranking with earliest-proposal tie-break, private audit rows, ordered veto/approval/default handling, and the 20-commands-per-10-seconds helper.
- Tests added: hostile command and Unicode input matrices; moderation checks for zero-width/compatibility characters, URLs, mentions, profanity, lengths and unsupported characters; proposal replacement/support, plurality/tie ordering, veto progression and safe default; limiter threshold coverage.
- Bugs found and fixed: changed name review to begin only after the naming window closes; reordered moderation checks so long URL inputs are categorized safely; ensured candidate names stay out of public events until approval and writes of name decisions plus audit rows are transactional.
- Verification: typecheck and lint passed; 47 tests passed across 7 files; build, formatting check, and `git diff --check` passed.

## Phase 3 — Raid handoff, welcome, factions, resolution

- Added normalized raid/chat inputs to a shared event bus, transactional raid-event idempotency, configured-channel and matching-quest checks, persisted source/target participation cohorts, target `!join` classification, and a scripted A-to-B demo using the same bus and SQLite repositories.
- Tests added: duplicate raid and unmatched/unconfigured raid handling; missing viewer fallback; dismissed handoff; source-cohort and target-join faction classification; end-to-end scenario with raw viewer count and faction tallies asserted.
- Bugs found and fixed: made window-close resolution load persisted votes instead of trusting a caller-supplied list; added the final fallback return required by strict TypeScript and removed unused imports found by lint.
- Verification: typecheck, lint, all 52 tests across 9 files, production build, format check, and `git diff --check` passed. `pnpm demo` completed the A-to-B scenario with 37 raw viewers, medium tier, accepted handoff, faction resolution, completion, and duplicate raid ignored.

## Phase 4 — Realtime server, overlay, dashboard

- Added Fastify REST routes for health, quest creation and lifecycle actions, protected dashboard controls, overlay snapshots, and read-only chain APIs. Added rate limiting, security headers, constrained CORS, constant-time dashboard/overlay key checks, a scheduler for expired windows and welcome hold, and WebSocket snapshot/reconnect plus changed-field updates.
- Built the transparent OBS overlay, token-protected dashboard, demo controls, and a read-only persisted timeline with raw faction tallies. The interactive demo now plays the A-to-B lifecycle over time through the same event bus and marks simulated inputs.
- Tests added: 3 HTTP/WebSocket integration tests covering dashboard auth and private-name projection, REST rate limiting, initial WebSocket snapshot, update delivery, and reconnect resync.
- Bugs found and fixed: prevented pending candidate names from entering overlay snapshots; preserved HTTP rate-limit status codes in the error handler; exposed the demo control in an empty dashboard; corrected demo chain timestamps and local chain links; limited the simulated badge to current-round demo input.
- Verification: strict typecheck, ESLint, Prettier, shared/server TypeScript builds, Vite production build, `git diff --check`, and all 55 tests across 10 files passed. Browser walkthrough with two local demo channels showed naming, vote, raid welcome, completed outcome, SIMULATED badge, live dashboard updates without refresh, and public chain raw tallies. Live Twitch remains unverified and is Phase 5.

## Phase 5 — Real Twitch adapters

- Added a Twurple `RefreshingAuthProvider` and EventSub runtime that resolves configured logins with Helix, subscribes to chat and source-channel raids, maps resolved Twitch IDs to existing login-keyed quests, routes normalized inputs through the same `RelayEventBus`, and exposes socket health and last-event times on `/healthz` and dashboard snapshots. Token refreshes persist with restrictive file permissions; chat uses Twitch message-ID dedupe and HMAC-SHA256 voter keys; raid dedupe uses a persisted two-minute source/target/viewer window.
- Updated the OAuth and smoke scripts to use Twurple token format and refresh support. Smoke output remains hashed and excludes chat text and raw Twitch identifiers.
- Tests added: sanitized illustrative chat/raid fixture parsing, malformed raid rejection, voter HMAC/token migration helpers, persisted raid dedupe expiry, and a local fake EventSub WebSocket test that verifies Twurple follows `session_reconnect` to the replacement URL. These fixtures are not real captured payloads.
- Bugs found and fixed: avoided permanent nested raid dedupe suppressing a later legitimate matching raid by giving each post-window delivery a fresh bus event ID; included Twitch health in empty dashboard snapshots; rejected placeholder voter salts for live integration.
- Verification: strict TypeScript typecheck, ESLint, Prettier check, server TypeScript build, Vite production build, `git diff --check`, and 60 tests across 13 files passed. The full suite and reconnect test used local loopback permission. No Twitch credentials/live channels were used; live chat authorization across two channels, real raid viewer counts, token refresh against Twitch, and recovery after unexpected disconnect remain `TODO(verify)`.
