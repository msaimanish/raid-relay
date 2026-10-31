# Raid Relay agent rules

- This is a solo hackathon project. Work exactly one requested phase per turn; stop with a Phase Report and wait for `continue`.
- Inspect the existing tree, Git status and history before edits. Never overwrite/delete existing work silently. Keep changes small and prefer a reliable vertical slice.
- In each phase: short plan, implement, run typecheck/lint/tests and required manual checks, append an honest entry to `docs/CODEX_LOG.md`, commit with Conventional Commits, then report.
- Never claim unrun checks work. Mark unverified Twitch/NVIDIA API assumptions `TODO(verify)`. Never commit secrets; tokens, `.env`, and databases stay ignored.
- Treat chat and model output as untrusted. Validate schemas/allowlists, never execute generated code or render untrusted HTML.
- Deterministic game engine is authoritative. LLM may only write a validated two-sentence recap from facts supplied by the engine; it never counts votes, assigns factions, decides outcomes, reads raid size, or moderates.
- Use boring, well-known dependencies; explain heavy additions. Record small decisions in `docs/DECISIONS.md`. Ask at most one question and only when blocked.
- Follow the phase definitions and requirements in the project brief supplied by the user. Do not build non-goals: accounts, billing, Twitch Extension, autonomous LLM control, multi-agent systems, 3D, cloud deployment, or chat output from a bot.

## Product/security essentials

- Raid Relay gives raiders instant story context and a vote in the first minute after a Twitch raid.
- Preserve raw raid viewer count; derive small (1–9), medium (10–49), large (50+); missing stays null with explicit medium fallback.
- Factions are Incoming party and Locals. Twitch does not identify every raider; cohort rules and this limitation must be documented.
- One account vote per round (latest replaces); max 20 commands/account/10 seconds; malformed commands are ignored.
- Naming proposals are moderated and streamer-approved before becoming public canon; default is “the Ember Fox”.
- SQLite WAL/migrations, append-only public chain events, idempotency, snapshots over WebSocket, security headers, constrained CORS, constant-time token compare, and rate limits are required by their phases.
- OBS overlay: transparent dark 1920×1080, large readable text, reduced-motion support, no external fonts/assets, SIMULATED badge for demo inputs.
- Read-only chain pages must not expose user identifiers or rejected proposals. React escaping only; no `dangerouslySetInnerHTML`.

## Architecture and game rules

- Stack: Node 20+, strict TypeScript, pnpm; Fastify, `ws`, `better-sqlite3`, Zod, Pino, and Twurple in `server/`; Vite/React in `web/`; shared Zod contracts in `shared/`; Vitest, ESLint, and Prettier.
- Routes: `/overlay/:channel`, `/dashboard/:channel`, `/chain`, `/chain/:questId`. Use one event bus for live and demo inputs.
- Core quest: “The Ember Relic”; objective is to carry the relic to the end of the road. Beat 1 is protect (bond) or claim (power); beat 2 is fight, trade, or sneak. Outcomes are static, deterministic templates selected from a documented score table, with no randomness.
- State progression: `DRAFT → NAMING_OPEN → NAME_PENDING_APPROVAL → BEAT1_VOTING → AWAITING_RAID → HANDOFF_OFFERED → WELCOME → BEAT2_VOTING → COMPLETED`, with `HANDOFF_DISMISSED`. Server scheduler emits window-close events; engine has no timers or I/O. Pause freezes deadlines; resume shifts them by pause duration.
- Voting rule `v1-equal-faction-share`: each faction's choice share counts half when both factions voted; if only one voted, use that faction's share. No votes selects `sneak`; ties break by raw vote total then fixed choice order. Record raw tallies, shares, rule version, and outcome.
- SQLite uses WAL and migrations. Store append-only chain events, idempotency records, raw raid counts and derived tiers, timestamps, and hashed voter keys only; never expose voter identifiers in public views.
- Commands are `!name <text>`, `!vote <key|number>`, and `!join`. Latest proposal/vote per account replaces the earlier one. Flood cap is 20 commands per 10 seconds/account. Normalize Unicode, strip zero-width controls, moderate candidate names, and only publish an approved canon name.
- Recap provider has a safe template fallback. If NVIDIA recap is implemented, send engine facts only (never chat text or IDs), enforce timeout, exact two-sentence schema, moderation and number fact-guard, cache results, and record whether AI or fallback supplied it. AI never controls game state.
- The dashboard is token-protected and controls quest lifecycle; the overlay is transparent, readable at 1920×1080, and displays a SIMULATED badge for demo inputs. Chain pages are read-only timelines sourced from persisted events and work in light/dark modes.
- Twitch adapters normalize real EventSub chat and raid events into the same bus as demo input. Never claim live event delivery was verified unless it was tested against actual authorized channels and a real raid.
