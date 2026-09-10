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
other three and judge. GitHub Pages watches the conduit host bin. **Send plan**
on the page writes the seat inbox. Chat is for rules analysis and confirmation
backup, not the primary transport.

The user proposes a LINE (`plan` from the inbox, or pasted in chat). Before
changing the game, walk its mana, timing, targets, triggers, combat arithmetic,
and visible responses, then answer whether it works. Wait for the user to
confirm or replace the line (`confirm` / `replace`, or the same in chat). After
confirmation, execute until information changes (counter, block, removal of a
planned card, illegal next step, politics fork). Then pause, encode a NOW
snapshot into conduit (host public + human seat private), and keep using the
**same** private URL:

```text
https://lordnox.github.io/commander-decks/live/?k=<seatRead>%7C<inboxWrite>
```

Always use `/live/` with the trailing slash. GitHub Pages redirects `/live`
and that can drop a fragment. Do not spam new `v2.` payload links when conduit
is working. Hidden libraries never go in the URL. Write keys never go on a
public link.

This is **not** a rules engine and **not** the replay archive. Snapshot wire
format: [`schema.md`](schema.md). Conduit bins, mint, inbox JSON, and URL
params: [`CONDUIT.md`](CONDUIT.md) (frozen; do not invent extra query params).
Play-to-win for the other seats: [`simulate-table`](../simulate-table/SKILL.md).

## Start / continue

1. Deal and play with `simulate-table` as usual (pod, deal, seat agents, replay
   events). Mark one seat `human` (`p1`–`p4`).
2. Mint the nine bins (`host`, `p1`, `p1-inbox`, … `p4-inbox`). The mint key
   comes from `LIVE_CONDUIT_API_KEY` or `~/.config/commander-decks/live-conduit.env`
   (`LIVE_CONDUIT_URL` optional):

   ```bash
   python3 .agents/skills/live-table/scripts/encode_live.py table-games/<slug>.json \
     --you p2 --conduit --conduit-keys table-games/<slug>.conduit.json
   ```

   Keys stay gitignored (`*.conduit.json`, and/or `_conduit` on
   `table-games/<slug>.live.json`). Never commit them or put them in a replay.
3. Persist working state as `table-games/<slug>.live.json` (gitignored). Keep
   `_libraries` only in that local file — never in the URL, never in a
   committed replay.
4. Continue from the session file, not from chat history. Re-read
   `<slug>.live.json` every pause/resume.
5. Pause → encode and **append** the public snapshot to the `host` bin and
   the private snapshot to the human seat bin. Post **one** private `/live/`
   URL (params above). Do not mint again or post a new payload URL on later
   pauses unless the session lost conduit.
6. Poll/watch the human inbox. Accept `plan` / `confirm` / `replace` / `pass` JSON.
   Same pause/confirm rules as below: a proposal is not authorization until
   confirm.
7. If mint fails, fall back to payload `?s=` or short `--game` links (see
   Encode fallback).

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

On the human's main phase, attacker declaration, blocker declaration, or stack
decision, propose one legal candidate when useful and phrase the pause as
`Would this line work? ... Confirm or replace it.` A user proposal is analysis,
not authorization to append events. Do not commit it until the user confirms
after seeing the checked sequence and likely responses.

Every play prompt also publishes the actions that seat may currently send and
a per-seat action ID. The client echoes that ID. Reject stale, duplicate, or
unavailable play actions without invoking the judge. Do not let one priority
responder invalidate another responder's still-open action ID.

## Phase walk and priority windows

At a judged table every seat watches its own bin, so the log is the only way a
seat learns that its window arrived. Name each step you enter as its own event,
even the empty ones, and say who may act.

Walk untap, upkeep, draw, precombat main, beginning of combat, declare
attackers, declare blockers, combat damage, postcombat main, end step, and
cleanup. A step nothing happens in still gets one line that says so
(`Upkeep — no triggers.`). Use the step's own phase on the event.

Phase `planning` belongs only to a turn that has not stepped anywhere yet.
When you pause mid-turn for someone's next decision, the pause event carries
the step the game is actually in, since the board's step rail reads that phase
and would otherwise walk back to the top of the turn.

**Open a window** — an event with `kind: "priority"` in phase `priority` that
names the seats who may act — whenever a seat could legally change the outcome:

- an object goes on the stack (spell, activated ability, triggered ability)
- declare attackers and declare blockers
- before combat damage, when a pump, fog, or removal would matter
- the active seat's end step
- a politics fork that changes someone's line

Do not open a window where nothing can respond: an empty untap, a land drop
onto an empty board, a draw with no triggers. Say the step happened and move
on. A window is expensive — each seat's answer costs a judging round — so open
the ones that matter and skip the ceremony.

An open window names its responders and how to answer: `plan` to respond or
`pass` for no action. Put those seats on the event as `seats`, since the
encoder shows the prompt only to the seats it is addressed to and gives
everyone else a neutral `Waiting on …` line. `talk` is social speech only. Hold the game there. Execute a standing plan only up to the
next window, then stop and publish.

## Standing plan

The confirmed line (inbox `confirm`, or chat confirmation after analysis) is
the standing plan. Execute it in order.

- On interrupt (counter, unexpected block, removal of a planned card, illegal
  next step, politics fork): **STOP**. Do not invent the rest of the line.
- Re-encode NOW into the same host + seat bins, keep the same live URL, and
  ask what they do next.
- Never assume post-counter sequencing from the old plan.
- After completing the confirmed human turn, run the same Oracle, stats,
  commander-zone, and trigger-causality audit required by `simulate-table`
  before the next untap. For every trigger already recorded, identify the
  preceding event that satisfied its printed condition and confirm the source
  existed then; correct the game if those facts do not line up.

## Encode and post

Prefer conduit. Encode into bins (host body is the full `v2.…` ASCII snapshot
string). Chat posts the **private** live URL once:

```text
https://lordnox.github.io/commander-decks/live/?k=<p2Read>%7C<p2InboxWrite>
```

Optional `c` = conduit origin (no trailing slash). Omit `c` when it is the
default. Mention the Pages UI has **Copy public link** (`?k=<hostRead>`
only) for sharing. No write keys, no other seats' read keys, no `_libraries`.

Use the live session path when that is the working file. Pass the human seat
as `--you`. Put only explicit player speech in `--talk`, a generic table status
in `--judge`, the submitting seat's complete analysis in its private judge
note, a one-sentence private history summary, and the exact actionable prompt
in that seat's private waiting field. Keep both exact card names and sequence
for the submitting seat. Other seats and spectators must learn only that the
player is conferring with the judge. Redacting card names is not sufficient
because deck knowledge can reveal the line from mana and strategic clues.
Retain at most eight private summaries per seat. Add `--event <id>` to pick an earlier frame instead of
the last one (human takeover: frame **before** that seat's next own decision).

### Encode fallback (mint failed)

When the game is already published, a short link (no payload):

```bash
python3 .agents/skills/live-table/scripts/encode_live.py table-games/<slug>.json \
  --game <slug> --event <id> --you p2 --talk "..." \
  --waiting "Would this line work? Confirm or replace it."
```

For an unpublished game, omit `--game` so the encoder emits a self-contained
`?s=<payload>` URL (`v2.`). That payload names the four deck slugs and stores
board cards as `deckIndex * 128 + slot` into each published 99. Warn and
publish instead if that query is over ~6000 characters; the encoder still
prints `#s=` past 8000. Extra cards that are not in any 99 keep a tiny catalog
of Scryfall printing IDs; the browser downloads `decks/<slug>.json` and
hydrates the rest client-side. Do not inline card details when an ID exists.

## Rules kernel and special cards

The live-runner opens `table-games/<slug>.kernel.json` when play starts. That
journal is the host's authoritative reducer log (`initial` plus accepted
`GameEvent`s). Reconnects restore it. Passes go through `{ type: 'passPriority' }`.
The Pages client receives a redacted replica plus history frames and can step
backward without changing the host.

Most cards need no extra code. Cards with weird rules (Yurlok of Scorch Thrash
is the template) are listed in [`cards/rules-plugins.json`](../../../cards/rules-plugins.json)
by Oracle ID. That overlay grants **static** `pluginIds` (mana burn, replacement
effects) while the object is on the battlefield. Activated abilities use
`{ type: 'activateAbility', abilityId, seat, objectId }`. Mark `manaAbility: true`
when the line is a mana ability; the kernel only checks that flag and priority,
it does not open the window. The host decides when that timing is legal.

When a new deck or card introduces an interaction the kernel cannot represent:

1. Pause. Do not execute the line.
2. Add `rules-engine/src/cardPlugins/<id>.ts` and a test that would fail on the
   old behavior.
3. Register static effects under `pluginIds` and activated handlers under
   `handlerIds` in `cards/rules-plugins.json`.
4. Commit and push that plugin. Later tables reuse it.

The host agent copies those files back from its scratch worktree when
`pluginsChanged` is true, then reloads `handlerIds`. Only a confirmed line may
replace the kernel journal; plan, replace, rules, pass, and talk are read-only.
Generic effects stay in builtin plugins; card files are only for odd Oracle.
Published snapshots retain the latest 32 history frames and 128 trace events;
the append-only host journal remains complete.

## Long-running host/seat (no poll)

A Cursor chat must not poll conduit. The Bun **live-runner**
(`live-runner/PLAN.md`, `live-runner/IMPLEMENTATION.md`) holds WebSockets and
session files. Chat starts it in the background (pid + log) and exits. Human
`/live` still uses Pages + this skill.

## After the game

DELETE the bin write keys. Optional: hand the finished replay to
`render-table-replay` for the archive player. Live `/live/` is only the current
NOW frame — do not treat a payload or conduit snapshot as a recorded game.
