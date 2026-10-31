# Decisions

- Phase 0 uses pnpm workspaces with `server`, `web`, and `shared` packages; all compile as strict TypeScript.
- Keep Twitch setup scripts self-contained on Node built-ins and Twurple packages; avoid adding an HTTP framework before the product server phase. Run TypeScript entrypoints with Node's `--import tsx/esm` to avoid the tsx CLI IPC server.
- OAuth uses the authorization-code flow and stores tokens under `.data/`, which is ignored by Git. Smoke output hashes account/channel identifiers and never prints chat text.
- Chat EventSub subscriptions use the authorized user with `user:read:chat`; incoming raid subscriptions use `channel.raid` filtered by source broadcaster and require no authorization. Verify permissions against the live Twitch app before relying on them.
- Resolved Twurple package versions are 7.4.0; the dependency declarations use compatible 7.3.x minimum ranges pending a later implementation pass.
- Phase 1 stores candidate names only in private quest state; pending or rejected proposal text is omitted from append-only chain events. Party size zero is retained verbatim and mapped to the small tier; only null triggers the medium fallback.
- Beat 1's no-vote default is `protect`, since `sneak` is not a valid beat-1 choice; beat 2's default is `sneak`. Outcome scores use triumph ≥4, costly win =3, setback ≤2, as recorded in `docs/RULES.md`.
- Phase 2 normalizes candidate names with Unicode NFKC, removes Unicode format controls, folds whitespace, and groups by lower-case normalized text. The initial blocked-term list is intentionally small; every candidate also must pass URL, mention, length, and character checks.
- After all eligible proposals are vetoed or moderated out, the system selects the fixed safe default `the Ember Fox` and opens beat-1 voting. A chat-submitted name becomes canon only after streamer approval.
- If proposal timestamps tie at millisecond precision after equal plurality, normalized-name lexical order is the final deterministic tie-break.
