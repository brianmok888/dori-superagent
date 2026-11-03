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

export const pollTelegramInbound = async (tg: Telegram, store: TgInboundStore, opts: TgInboundOptions): Promise<TgInbound[]> => {
  const updates = await tg.call<readonly TgUpdate[]>("getUpdates", { offset: store.load(), timeout: 25, allowed_updates: ["message"] });
  const out: TgInbound[] = [];
  for (const u of updates) {
    // Persist before filtering: a restart neither replays dropped updates nor loses them.
    store.save(u.update_id + 1);
    const m = u.message;
    if (!m?.from || m.from.is_bot) continue;
    if (m.from.id !== opts.ownerId) continue;
    if (m.chat?.type === "private" && Number(m.chat.id) === opts.ownerId) {
      out.push({ source: "dm", chat: Number(m.chat.id), updateId: u.update_id, from: m.from.id, username: m.from.username, text: m.text ?? m.caption });
      continue;
    }
    if ((m.chat?.type === "group" || m.chat?.type === "supergroup") && opts.groupChatId !== undefined && Number(m.chat.id) === opts.groupChatId) {
      const thread = m.message_thread_id ?? 1;
      // De-conflict: in a forum group the Dori only ever listens to its own topic.
      if (opts.topicId !== undefined && thread !== opts.topicId) continue;
      out.push({ source: "topic", chat: Number(m.chat.id), thread, updateId: u.update_id, from: m.from.id, username: m.from.username, text: m.text ?? m.caption });
    }
  }
  return out;
};
