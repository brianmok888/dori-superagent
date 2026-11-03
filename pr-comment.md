Both fixed, plus the mkdir:

- **General replies**: thread resolution now keys on `is_topic_message`. A reply in General (reply-root id in `message_thread_id`, `is_topic_message` false) resolves to topic 1 and passes a `topicId: 1` gate; tested with both a direct General post and a reply. Topic messages in configured topics unchanged.
- **DM topics**: DMs now carry `thread` when Telegram marks the message `is_topic_message`, so `telegram:<chat>/<topic>` binds; plain DMs stay threadless. Tested both.
- **mkdir**: `fileTgInboundStore.save` creates the state dir (`recursive`), tested against a nested path — no more ENOENT loop on a fresh install.

Suite: 261 pass, 0 fail; `bunx tsc --noEmit` clean. Happy to take the `edited_message`/`voice` coverage in the follow-up issue whenever you file it.
