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
- Follow-up fix: the first runtime assumed one token could authorize subscriptions for all configured channels and read only one token object. Twitch/Twurple reported a missing user token for the second broadcaster's raid subscription. Runtime and smoke setup now load a singleton or token array into `RefreshingAuthProvider`, require one matching broadcaster token per configured channel, use that token's ID for chat and raid subscription contexts, and atomically persist the full token array on refresh. The OAuth script now appends/replaces per-user entries instead of overwriting the file. Added token-array parsing coverage. Manual two-account Twitch verification is still pending.
- Follow-up verification: typecheck, lint, formatting, server build, `git diff --check`, and all 61 tests across 13 files passed. The Vite proxy behavior was not exercised against the manually authorized tokens.

## Phase 6 — Recap provider and public story chain

- Added deterministic two-sentence template recaps and an optional NVIDIA Nemotron provider using Node `fetch`, the documented hosted chat-completions endpoint, JSON-schema response format, disabled Bolt thinking, and a configurable timeout. Recaps are generated asynchronously after a matched raid: the template is available immediately, and only validated AI text can replace it. The overlay receives the text and `recap_source`; the dashboard labels the source. Resolved Twitch display names are used in the recap facts when available.
- Added strict recap schema, sentence length/count checks, shared URL/mention/profanity/control-character moderation, and a numeric fact guard. The model receives only the specified quest and raid facts; no chat messages or voter identifiers are sent.
- Expanded public chain summaries with source/target, party count/tier, outcome, and update time. The detail timeline continues to read safe persisted events and show raw faction tallies while filtering private proposal data.
- Tests added: mocked NVIDIA success with structured output and reasoning separated; malformed JSON, unsafe URLs/mentions, extra numbers, 429/500, timeout, template fallback, immediate recap cache and per-raid reuse; existing chain API privacy test remains in the suite.
- Decisions: use `nvidia/nemotron-3.5-bolt-e4b` as configurable default, `enable_thinking: false`, and Node `fetch` to avoid adding an SDK. The deterministic template remains the fallback for every provider or validation failure.
- Verification: strict typecheck, ESLint, Prettier, server TypeScript build, Vite production build, and all 73 tests across 15 files passed. NVIDIA requests were mocked; no live key/API call was made.

## Dev server follow-up — Root environment and WebSocket rejection

- Diagnosed the reported Vite `socket hang up`: `pnpm dev` runs the server with `server/` as its current directory, while `dotenv/config` searched only there. The repository `.env` was at the root and `server/.env` was absent, so the backend used default channel/auth settings. Configured database and Twitch token paths were also relative to the wrong directory.
- Changed server startup to load the root `.env` and resolve relative data/token paths from the project root. Invalid WebSocket upgrades now receive explicit HTTP 401/404/429 responses rather than being silently destroyed. README warns against including placeholder angle brackets in URL values.
- Verified the running backend reports Twitch `connected` at `/healthz`; an intentionally invalid dashboard key through Vite received HTTP 401. Strict typecheck, lint, formatting, server build, `git diff --check`, and all 76 tests across 16 files passed.

## Phase 6 follow-up — Abandon a stuck active quest

- Corrected dashboard guidance for a quest paused in `AWAITING_RAID`: it cannot be dismissed through the existing handoff action and blocks the demo as an active quest.
- Added an authenticated dashboard **Abandon quest** action, including for paused quests. Abandonment is persisted as a terminal status and public chain event, clears paused/deadline/pending-name state, and frees the channel for another quest or demo. Added a confirmation prompt.
- Verification: typecheck, lint, server build, web build, formatting, and `git diff --check` passed. 75 tests passed; 3 WebSocket tests could not bind loopback sockets because this environment returned `listen EPERM: operation not permitted 127.0.0.1`.

## WebSocket preview follow-up — Strict Mode development replay

- Traced the preview's immediate WebSocket connection to the `useRelaySocket` effect. React Strict Mode replays effects on development mounts, so cleanup could close the first connection during Vite's proxy upgrade and produce a repeatable `ECONNRESET` log on preview open.
- Deferred the initial WebSocket attempt by one event-loop turn; Strict Mode cleanup cancels the transient mount before it reaches Vite's proxy.
- Verification: pending in this restricted runtime; the browser's Vite/WebSocket behavior must be checked by reopening the preview in the user's running `pnpm dev` session.

## Phase 7 — Demo mode, hardening, clean install

- Repeated the standalone `pnpm demo` path twice; each fresh in-memory SQLite run reached `COMPLETED` with the same two-channel story, preserved 37 raw viewers as medium tier, and ignored the duplicate raid.
- Added an HTTP integration test that seeds the scripted scenario through the shared event bus and verifies the persisted completion appears in the authenticated overlay snapshot and public chain API, including the simulated marker and raw raid size.
- Clean-copy install succeeded with `pnpm install --frozen-lockfile` in a disposable copy after the offline attempt found a missing cached tarball. Copied `.env.example` to `.env`, then ran `pnpm demo` twice from that copy; both reached `COMPLETED`. The clean-copy install reused the existing pnpm content store; it did not download packages.
- Verification: typecheck, lint, workspace build, formatting, and `git diff --check` passed. Full suite: 76 passed, 3 failed because this environment denies loopback listeners (`listen EPERM`); the new demo-to-overlay/chain integration test passed independently. Browser preview and chain pages were not opened manually here.

## Phase 8 — Docs and submission assets

- Reworked README quick start to separate simulated browser/CLI demos from optional live Twitch and NVIDIA setup, document route purpose and active-quest/demo prerequisites, include an architecture diagram, real-vs-simulated status, limitations, privacy, and verification commands.
- Added a truthful Devpost draft, a timed under-three-minute demo shot list, and a submission checklist covering reproducibility, secrets, live-verification caveats, and attribution limits.
- Verification: docs formatted with Prettier; typecheck, lint, workspace build, and `git diff --check` passed. Full test run had 76 passing tests and 3 loopback-dependent failures (`listen EPERM`) in this restricted environment. The clean-copy setup and CLI demo were exercised during Phase 7; browser-based visual verification remains outstanding.

## Overlay screenshot follow-up — Abandoned quest state

- Reviewed the user's dashboard, overlay, and chain screenshots. The chain views matched the intended persisted history; the overlay displayed an empty story area and “Name pending” for an `ABANDONED` quest.
- Added an explicit closed-story overlay card and status chip for abandoned quests. The translucent overlay canvas is intentional for OBS compositing.
- Found that channel snapshot selection preferred any quest where the channel was current over a newer quest where it was the source. Changed it to choose by most recent update and added a regression assertion that the source overlay follows the completed demo despite an older abandoned quest.
- Verification: targeted source-overlay regression passed; typecheck, lint, server build, web build, Prettier, and `git diff --check` passed. Full suite: 76 passed; 3 loopback WebSocket tests failed with `listen EPERM`. The user's local browser was not available for a post-change visual check.
