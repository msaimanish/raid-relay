import { z } from "zod";

export const TwitchChatEventSchema = z.object({
  message_id: z.string().min(1),
  broadcaster_user_id: z.string().min(1),
  chatter_user_id: z.string().min(1),
  message: z.object({ text: z.string().max(1000) }),
});

export const TwitchRaidEventSchema = z.object({
  from_broadcaster_user_id: z.string().min(1),
  to_broadcaster_user_id: z.string().min(1),
  viewers: z.number().int().nonnegative(),
});

export function normalizeChatFixture(input: unknown) {
  const event = TwitchChatEventSchema.parse(input);
  return {
    eventId: event.message_id,
    broadcasterId: event.broadcaster_user_id,
    chatterId: event.chatter_user_id,
    text: event.message.text,
  };
}

export function normalizeRaidFixture(input: unknown) {
  const event = TwitchRaidEventSchema.parse(input);
  return {
    sourceBroadcasterId: event.from_broadcaster_user_id,
    targetBroadcasterId: event.to_broadcaster_user_id,
    viewers: event.viewers,
  };
}
