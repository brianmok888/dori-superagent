import { readFileSync, writeFileSync } from "node:fs";

import type { Telegram } from "./telegram.ts";

export type TgInbound = {
  readonly source: "dm" | "topic";
  readonly chat: number;
  readonly thread?: number;
  readonly updateId: number;
  readonly from: number;
  readonly username?: string;
  readonly text?: string;
};

/**
 * Owner-gated Telegram inbound: DMs from the configured owner and, when a group topic is
 * configured, that owner's messages in that topic only. Everything else is dropped.
 */
export type TgInboundOptions = {
  readonly ownerId: number;
  readonly groupChatId?: number;
  readonly topicId?: number;
};

export type TgInboundStore = { load(): number; save(offset: number): void };

export const fileTgInboundStore = (path: string): TgInboundStore => ({
  load(): number {
    try {
      return Number(readFileSync(path, "utf8").trim()) || 0;
    } catch {
      return 0;
    }
  },
  save(offset: number): void {
    writeFileSync(path, String(offset));
  },
});

type TgUser = { readonly id: number; readonly is_bot?: boolean; readonly username?: string; readonly first_name?: string };
type TgMessage = {
  readonly message_id?: number;
  readonly from?: TgUser;
  readonly chat?: { readonly id: number; readonly type?: string };
  readonly message_thread_id?: number;
  readonly text?: string;
  readonly caption?: string;
};
type TgUpdate = { readonly update_id: number; readonly message?: TgMessage };

/**
 * Poll `getUpdates` once and hand every kept message to `emit` as it is processed.
 *
 * Delivery is at-least-once: the stored offset advances past a message only after `emit`
 * returned for it (a throwing `emit` aborts the batch with the offset left before the
 * message, so the next poll returns it again — duplicates carry the same `updateId`).
 * Updates that are dropped by the gates advance the offset immediately: there is nothing
 * to deliver for them, and `getUpdates` cannot replay a message a bot has consumed.
 */
export const pollTelegramInbound = async (
  tg: Telegram,
  store: TgInboundStore,
  opts: TgInboundOptions,
  emit: (inbound: TgInbound) => void = () => {},
): Promise<TgInbound[]> => {
  const updates = await tg.call<readonly TgUpdate[]>("getUpdates", { offset: store.load(), timeout: 25, allowed_updates: ["message"] });
  const out: TgInbound[] = [];
  for (const u of updates) {
    const m = u.message;
    let keep = false;
    if (m?.from && !m.from.is_bot && m.from.id === opts.ownerId) {
      if (m.chat?.type === "private" && Number(m.chat.id) === opts.ownerId) keep = true;
      else if ((m.chat?.type === "group" || m.chat?.type === "supergroup") && opts.groupChatId !== undefined && Number(m.chat.id) === opts.groupChatId) {
        // De-conflict: in a forum group the Dori only ever listens to its own topic.
        keep = opts.topicId === undefined || (m.message_thread_id ?? 1) === opts.topicId;
      }
    }
    if (!keep) {
      store.save(u.update_id + 1);
      continue;
    }
    const source = m!.chat!.type === "private" ? "dm" : "topic";
    const inbound: TgInbound = {
      source,
      chat: Number(m!.chat!.id),
      ...(source === "topic" ? { thread: m!.message_thread_id ?? 1 } : {}),
      updateId: u.update_id,
      from: m!.from!.id,
      ...(m!.from!.username === undefined ? {} : { username: m!.from!.username }),
      ...(m!.text === undefined && m!.caption === undefined ? {} : { text: m!.text ?? m!.caption }),
    };
    emit(inbound); // may throw: offset stays before this update, so it is polled again
    out.push(inbound);
    store.save(u.update_id + 1);
  }
  return out;
};
