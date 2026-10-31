# Decisions

- Phase 0 uses pnpm workspaces with `server`, `web`, and `shared` packages; all compile as strict TypeScript.
- Keep Twitch setup scripts self-contained on Node built-ins and Twurple packages; avoid adding an HTTP framework before the product server phase. Run TypeScript entrypoints with Node's `--import tsx/esm` to avoid the tsx CLI IPC server.
- OAuth uses the authorization-code flow and stores tokens under `.data/`, which is ignored by Git. Smoke output hashes account/channel identifiers and never prints chat text.
- Chat EventSub subscriptions use the authorized user with `user:read:chat`; incoming raid subscriptions use `channel.raid` filtered by source broadcaster and require no authorization. Verify permissions against the live Twitch app before relying on them.
- Resolved Twurple package versions are 7.4.0; the dependency declarations use compatible 7.3.x minimum ranges pending a later implementation pass.
