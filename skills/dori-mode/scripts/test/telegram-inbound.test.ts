import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import type { Http, HttpRequest, HttpResponse } from "../src/messenger/http.ts";
import { Telegram } from "../src/messenger/telegram.ts";
import { fileTgInboundStore, pollTelegramInbound } from "../src/messenger/telegram-inbound.ts";
import { fakeClock, withState } from "./fakes.ts";

const OWNER = 5250;
const OTHER = 6612;
const GROUP = -1004;
const TOPIC = 3;

const state = withState();
afterEach(() => {});

type U = { update_id: number; message?: unknown };

const msg = (from: number, chatId: number, type: string, text: string, thread?: number) => ({
  message_id: 1,
  from: { id: from, is_bot: false, username: from === OWNER ? "owner" : "someone" },
  chat: { id: chatId, type },
  ...(thread === undefined ? {} : { message_thread_id: thread }),
  text,
});

const telegramFake = (batches: U[][]) => {
  const bodies: Record<string, unknown>[] = [];
  const http: Http = async (req: HttpRequest): Promise<HttpResponse> => {
    const method = req.url.split("/").pop() ?? "";
    const body = JSON.parse(String(req.body ?? "{}")) as Record<string, unknown>;
    bodies.push(body);
    const batch = batches.shift() ?? [];
    return {
      status: 200,
      body: JSON.stringify({ ok: true, result: batch }),
    };
    void method;
  };
  return { http, bodies };
};

const mk = (http: Http) => new Telegram(http, fakeClock(), "T");

test("owner DMs pass, non-owner and bot messages drop, offset still advances", async () => {
  const { http, bodies } = telegramFake([
    [
      { update_id: 10, message: msg(OWNER, OWNER, "private", "hi") },
      { update_id: 11, message: msg(OTHER, OTHER, "private", "intruder") },
      { update_id: 12, message: msg(777, OWNER, "private", "bot ping") },
    ],
  ]);
  const store = fileTgInboundStore(join(state.dir, "tg-off-1"));
  const out = await pollTelegramInbound(mk(http), store, { ownerId: OWNER, groupChatId: GROUP, topicId: TOPIC });
  expect(out.length).toBe(1);
  expect(out[0].source).toBe("dm");
  expect(out[0].text).toBe("hi");
  expect(out[0].updateId).toBe(10);
  // Offset persisted past ALL updates, including the dropped ones — no replay, no loss.
  expect(store.load()).toBe(13);
  expect(bodies[0].offset).toBe(0);
});

test("configured topic passes, other topics and other groups drop", async () => {
  const { http } = telegramFake([
    [
      { update_id: 20, message: msg(OWNER, GROUP, "supergroup", "in topic", TOPIC) },
      { update_id: 21, message: msg(OWNER, GROUP, "supergroup", "wrong topic", 555) },
      { update_id: 22, message: msg(OWNER, -999, "supergroup", "wrong group", TOPIC) },
    ],
  ]);
  const store = fileTgInboundStore(join(state.dir, "tg-off-2"));
  const out = await pollTelegramInbound(mk(http), store, { ownerId: OWNER, groupChatId: GROUP, topicId: TOPIC });
  expect(out.length).toBe(1);
  expect(out[0].source).toBe("topic");
  expect(out[0].thread).toBe(TOPIC);
  expect(out[0].text).toBe("in topic");
  expect(store.load()).toBe(23);
});

test("messages without a thread id land in the General topic (thread 1)", async () => {
  const { http } = telegramFake([[{ update_id: 30, message: msg(OWNER, GROUP, "supergroup", "general") }]]);
  const store = fileTgInboundStore(join(state.dir, "tg-off-3"));
  const out = await pollTelegramInbound(mk(http), store, { ownerId: OWNER, groupChatId: GROUP, topicId: 1 });
  expect(out.length).toBe(1);
  expect(out[0].thread).toBe(1);
});

test("without a configured group only DMs arrive", async () => {
  const { http } = telegramFake([[{ update_id: 40, message: msg(OWNER, GROUP, "supergroup", "group msg", TOPIC) }]]);
  const store = fileTgInboundStore(join(state.dir, "tg-off-4"));
  const out = await pollTelegramInbound(mk(http), store, { ownerId: OWNER });
  expect(out.length).toBe(0);
});

test("restart resumes from the persisted offset", async () => {
  const { http, bodies } = telegramFake([[], [{ update_id: 50, message: msg(OWNER, OWNER, "private", "after restart") }]]);
  const store = fileTgInboundStore(join(state.dir, "tg-off-5"));
  store.save(50); // what a previous run persisted
  const first = await pollTelegramInbound(mk(http), store, { ownerId: OWNER });
  expect(first.length).toBe(0);
  expect(bodies[0].offset).toBe(50);
  const second = await pollTelegramInbound(mk(http), store, { ownerId: OWNER });
  expect(second.length).toBe(1);
  expect(second[0].updateId).toBe(50);
  expect(bodies[1].offset).toBe(50);
  expect(store.load()).toBe(51);
});
