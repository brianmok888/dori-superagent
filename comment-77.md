Ready — implemented on top of #76's branch (`telegram-inbound`), same review flow as agreed:

- **Edits**: `allowed_updates` now includes `edited_message`; an edit is printed as its own kind — `INBOUND edit <source> <chat> <thread> <update-id> <from> <edited text>` — and passes the same owner/topic gates as a new message. Tested: edit kind + edited text, mixed edit/message batch.
- **Voice and media**: a media message no longer prints as empty text. The line appends `file=<kind>:<file_id>` (voice, audio, video, video_note, animation, document, photo — largest variant for photos) and `TgInbound` carries `{kind, fileId, messageId}` so the file can be fetched for `dori transcribe`. Tested: voice note identity, photo with caption (text + largest photo).

Line shape is now `INBOUND <kind> <source> <chat> <thread> <update-id> <from> <text>[ file=<kind>:<file_id>]`; docs updated in `references/scripts.md`. Suite: 264 pass, 0 fail; `bunx tsc --noEmit` clean.

Pushed to `brianmok888:telegram-inbound` — I can move these two commits to a separate branch off `main` instead if you'd rather keep #76 scoped to the original review; say the word and I'll re-point the PRs.
