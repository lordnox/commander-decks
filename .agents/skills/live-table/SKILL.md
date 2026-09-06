---
name: live-table
description: >-
  Run a hot-seat Commander table where the human pilots one seat and the
  agent pilots the other three and judges. Use when the user wants a live
  table, to take over a seat, interact mid-game, play via /live, or hot-seat
  against agent opponents.
---

# Live Table

Chat hot-seat Commander: the user pilots one seat; you (the agent) pilot the
other three and judge. The user announces a LINE in chat. You execute until
information changes (counter, block, removal of a planned card, illegal next
step, politics fork). Then you pause, encode a NOW snapshot, and post:

```text
https://lordnox.github.io/commander-decks/live?s=<payload>
```

The user looks at the Pages board, writes in the page textbox if they want,
copies the plan, and pastes it in chat.

This is **not** a rules engine and **not** the replay archive. Snapshot wire
format: [`schema.md`](schema.md). Play-to-win for the other seats:
[`simulate-table`](../simulate-table/SKILL.md).

## Start / continue

1. Deal and play with `simulate-table` as usual (pod, deal, seat agents, replay
   events). Mark one seat `human` (`p1`–`p4`).
2. Persist working state as `table-games/<slug>.live.json` (gitignored). Keep
   `_libraries` only in that local file — never in the URL, never in a
   committed replay.
3. Continue from the session file, not from chat history. Re-read
   `<slug>.live.json` every pause/resume.

## Pause policy

Pause, encode, and ask whenever the human must decide or when information
changed under their standing plan:

- keep / mulligan
- human's main-phase actions
- attackers (human attacking or choosing defenders)
- blockers when the human cares (their attackers or their creatures)
- stack when they can respond or care
- politics forks (offers, answers, breaches that change their line)

Skip empty bookkeeping (untap with nothing to do, pure phase labels, opponent
auto-passes with no interaction). Do not spam snapshots.

## Standing plan

The pasted chat line is the standing plan. Execute it in order.

- On interrupt (counter, unexpected block, removal of a planned card, illegal
  next step, politics fork): **STOP**. Do not invent the rest of the line.
- Re-encode NOW, post the live URL, and ask what they do next.
- Never assume post-counter sequencing from the old plan.

## Encode and post

```bash
python3 .agents/skills/live-table/scripts/encode_live.py table-games/<slug>.json \
  --you p2 --talk "..." --waiting "What do you do?"
```

Add `--event <id>` to snapshot an earlier frame instead of the last one. Use it
when the human takes over a recorded game mid-log: pick the frame **before**
that seat's next own decision, since every later play by that seat was an agent
choice and is now discarded.

Use the live session path when that is the working file. Pass the human seat as
`--you`. Put table talk and the current standing plan in `--talk`; the prompt
in `--waiting`.

Chat posts the **private** live URL (viewer hand included for `--you`). Mention
the Pages UI has **Copy public link** for sharing (hands stripped). Hidden
libraries never go in the URL.

Prefer `?s=<payload>`. The encoder prints `#s=` instead when the query would
exceed 8000 characters.

## After the game

Optional: hand the finished replay to `render-table-replay` for the archive
player (`?game=`). Live `/live?s=` is only the current NOW frame — do not treat
it as a recorded game.
