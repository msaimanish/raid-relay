# Twitch integration notes

Verified against the official Twitch and Twurple documentation on 2026-10-31.

## Chat EventSub

- EventSub type: `channel.chat.message`, version `1`.
- Twitch requires `user:read:chat` from the user whose `user_id` is used for the subscription. With an app access token, Twitch also requires `user:bot` from that user and either `channel:bot` from the broadcaster or moderator status. For this project, use a user token with `user:read:chat` and confirm the chosen authorization arrangement with the live app. TODO(verify): Twurple's WebSocket subscription behavior with the intended authorization arrangement and two channels.
- Twurple documents `EventSubWsListener.onChannelChatMessage(broadcaster, user, handler)`. The broadcaster and user arguments are user IDs or resolvable User objects, not login strings.
- Chat payload contains Twitch user and message data. Smoke output must never print message text or raw user identifiers.

## Raid EventSub

- EventSub type: `channel.raid`, version `1`; set exactly one of `from_broadcaster_user_id` or `to_broadcaster_user_id`.
- The event includes source and target broadcaster IDs/logins/display names and integer `viewers`. Twitch says it only notifies raids that appear in chat.
- Incoming source-channel observation uses the `from_broadcaster_user_id` condition. Twitch lists no authorization requirement for this event.
- Twurple documents `EventSubWsListener.onChannelRaidFrom(user, handler)` and `onChannelRaidTo(user, handler)`.
- TODO(verify): observed real raid delivery and viewer count in this app’s actual channels.

## Auth and packages

- Twurple packages used by this project: `@twurple/auth`, `@twurple/api`, `@twurple/eventsub-ws`.
- Twurple documents `RefreshingAuthProvider` and `EventSubWsListener`; the auth setup script uses Twitch's standard OAuth authorization-code exchange through Node's built-in HTTP/fetch APIs.
- Resolved versions in `pnpm-lock.yaml` on 2026-10-31: `@twurple/auth`, `@twurple/api`, and `@twurple/eventsub-ws` 7.4.0. The package declarations use compatible `^7.3.0` ranges. Recheck at Phase 5 before building the live adapter.

## Sources

- [Twitch EventSub subscription types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types)
- [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating)
- [Twitch OAuth scopes](https://dev.twitch.tv/docs/authentication/scopes/)
- [Twurple EventSubWsListener reference](https://twurple.js.org/reference/eventsub-ws/classes/EventSubWsListener.html)
- [Twurple refreshing auth provider](https://twurple.js.org/docs/auth/providers/refreshing.html)
