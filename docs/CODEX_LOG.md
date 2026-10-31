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
