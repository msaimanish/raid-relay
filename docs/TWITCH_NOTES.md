# Twitch integration notes

Verified against the official Twitch and Twurple documentation on 2026-10-31.

## Chat EventSub

- EventSub type: `channel.chat.message`, version `1`.
- Twitch requires `user:read:chat` from the user whose `user_id` is used for the subscription. With an app access token, Twitch also requires `user:bot` from that user and either `channel:bot` from the broadcaster or moderator status. WebSocket subscriptions must use a user access token. This runtime loads the configured broadcaster's token for each channel's chat and raid subscriptions, and verifies `user:read:chat` for chat. TODO(verify): live delivery for both configured broadcasters.
- Twurple documents `EventSubWsListener.onChannelChatMessage(broadcaster, user, handler)`. The broadcaster and user arguments are user IDs or resolvable User objects, not login strings.
- Chat payload contains Twitch user and message data. Smoke output must never print message text or raw user identifiers.

## Raid EventSub

- EventSub type: `channel.raid`, version `1`; set exactly one of `from_broadcaster_user_id` or `to_broadcaster_user_id`.
- The event includes source and target broadcaster IDs/logins/display names and integer `viewers`. Twitch says it only notifies raids that appear in chat.
- Incoming source-channel observation uses the `from_broadcaster_user_id` condition. Twitch lists no extra scope requirement for this event, but the WebSocket subscription request still needs a user access token. Twurple associates `onChannelRaidFrom(user, ...)` with that user ID's auth context; therefore this runtime loads and uses the broadcaster's own token for outgoing raids.
- Twurple documents `EventSubWsListener.onChannelRaidFrom(user, handler)` and `onChannelRaidTo(user, handler)`.
- TODO(verify): observed real raid delivery and viewer count in this app’s actual channels.

## Auth and packages

- Twurple packages used by this project: `@twurple/auth`, `@twurple/api`, `@twurple/eventsub-ws`.
- Twurple documents `RefreshingAuthProvider` and `EventSubWsListener`; the auth setup script uses Twitch's standard OAuth authorization-code exchange through Node's built-in HTTP/fetch APIs.
- Resolved versions in `pnpm-lock.yaml` on 2026-10-31: `@twurple/auth`, `@twurple/api`, and `@twurple/eventsub-ws` 7.4.0. The package declarations use compatible `^7.3.0` ranges. Recheck at Phase 5 before building the live adapter.
- `scripts/twitch-auth.ts` stores a JSON array of Twurple token objects with `userId` metadata, replacing a prior entry for the same account. Runtime also accepts a legacy single token object and earlier raw Twitch field names. Refresh writes the full account array atomically with mode `0600`. Never commit the token file.
- Current `EventSubWsListener` implementation handles welcome, keepalive, `session_reconnect` URL handoff, and subscription startup on a newly created session. A local fake WebSocket test passed the `session_reconnect` replacement URL flow with pinned Twurple 7.4.0. TODO(verify): test recovery from an unexpected disconnect and live reconnect behavior. The app reports configured broadcaster socket connection state and token refresh failures.
- Chat EventSub message IDs are durable idempotency keys. Raid events have no event ID in Twurple's exposed raid object, so the app uses source, target and raw viewer count with a persisted two-minute idempotency window.
- Contract test payloads are sanitized illustrative examples based on Twitch's documented event fields; Phase 0 did not preserve captured real payload fixtures. TODO(verify): capture and sanitize actual authorized chat and raid payloads before claiming live contract coverage.
- The implementation resolves configured channel logins to IDs through Helix, requires a matching broadcaster token for every configured channel, and routes observed IDs back to the existing login-keyed quest model. A one-token multi-channel setup is not supported for raid subscriptions.
- Raid subscriptions listen to raids originating from each configured channel and route only when the target is also configured. TODO(verify): a real cross-channel raid delivers the expected viewer count and handoff.

## Sources

- [Twitch EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types)
- [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating)
- [Twitch OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/)
- [Twurple EventSubWsListener reference](https://twurple.js.org/reference/eventsub-ws/classes/EventSubWsListener.html)
- [Twurple refreshing auth provider](https://twurple.js.org/docs/auth/providers/refreshing.html)
- [Twitch EventSub reference](https://dev.twitch.tv/docs/eventsub/eventsub-reference)
- [Twitch managing subscriptions](https://dev.twitch.tv/docs/eventsub/manage-subscriptions/)
