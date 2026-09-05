---
name: review-table
description: >-
  Diagnose recorded simulate-table games: list gaps for a deck across
  replays, or pilot errors in one or more games. Use when the user asks
  what went wrong, which cards were bad, whether a deck needed more lands,
  ramp, or interaction, whether the agent played badly, missed a win,
  attacked in the wrong order, or held mana without using a counter or
  draw spell.
---

# Review Table

Read recorded `simulate-table` replays and say what went wrong. This skill
does not play a new game and does not edit a 99. Findings are a diagnosis.
Follow `simulate-table` only when the user wants another match; follow
`render-table-replay` only when they want the HTML viewer.

Two modes. Pick one from the request; if both are in scope, run them as
separate reports.

- **Mode A — list:** all games with deck X. What is the deck missing? Which
  cards were dead? Should it have run more lands, ramp, interaction, and so on.
- **Mode B — pilot:** one game or several games. Did the agent play badly?
  Did deck Y fail to set up its win? Did deck Z not attack correctly? Did
  deck W keep mana open and never cast the counter or draw spell?

## 1. Gather replays

Finished replays live in `table-games/*.json`. Scratch files are gitignored;
committed examples still count. The default scan excludes
`*.working.json`, which contains continuation state rather than a finished
game. Do not load a full replay into chat. Always run the summarizer first:

```bash
python3 .agents/skills/review-table/scripts/summarize_replays.py --list
```

Filter to a deck (Mode A default):

```bash
python3 .agents/skills/review-table/scripts/summarize_replays.py --deck "Misty Critters"
```

Digest specific files, optionally one seat (Mode B):

```bash
python3 .agents/skills/review-table/scripts/summarize_replays.py \
  table-games/<slug>.json --seat osgir
```

If the user names no files and no deck, list every replay and ask which mode
and which seats, unless only one replay exists.

Read each matching deck's primer, `cards.json` categories, and `DECISIONS.md`
before judging. Read [schema.md](../simulate-table/schema.md) only when a
flag or snapshot looks malformed. Heuristics for flags:
[heuristics.md](heuristics.md).

Current replays have a mixed `references` glossary. The summarizer resolves
numeric card, player, and deal IDs into names and terms. It marks older files
as `format: legacy`; those lack recorded reasons and politics, so do not infer
intent from silence.

## 2. Mode A — list

Ask: given these seats, what should the 99 have done that it could not?

For the focus deck, across every matching replay:

1. Keep quality and mulligans versus the primer's keep rules.
2. Land drops, missed drops (`flags.missed_land_drops`), and whether the
   opening and curve needed more lands.
3. Ramp and mana sinks: commander or engine on the primer's expected turn,
   or stuck on rocks / no rocks.
4. Interaction: answers in hand or deck versus the threats that actually
   killed or buried the plan.
5. Dead cards: `never_deployed` that are not legitimate held interaction.
   Use categories from that deck's `cards.json` and check `decisions`: a card
   explicitly held for protection, politics, or a later window is not "bad"
   merely because it finished in hand.
6. Win setup: did the deck assemble its documented combo or engine, or did
   the list never draw the missing piece?

Separate **variance** (this seed never drew the land) from **list shape**
(zero cheap interaction, 32 lands into repeated floods, the "bad" card is
off-plan). One replay is an anecdote. Say so.

Do not recommend generic staples. If a swap is warranted, name the job the
slot failed at and wait for the user before editing. `audit-deck` owns a
full Scryfall slot pass.

## 3. Mode B — pilot

Ask: with the cards that were actually in hand, battlefield, and known
zones, did this seat play them in the wrong order?

For each requested seat, or every seat if unspecified:

1. Primer plan versus the line taken. Setup that delays the win for a
   worse rock is a miss; dumping the hand when the primer holds up
   interaction is also a miss.
2. Deterministic wins: at each main phase, if a walkable win existed from
   public cards, missing it is a pilot error (and would invalidate the
   original sim).
3. Combat: attack with creatures that can still be sacrificed at instant
   speed **before** sacrificing them. Example: five Squirrel tokens that
   will be food for a sac outlet this turn should swing first unless
   blocking or a fog is the actual plan.
4. Open mana: inspect recorded `decision.available`, `held`, `held_for`,
   `play_later`, and `reason` first. Check whether the stated later window
   happened and whether the seat followed through. `flags.unused_reactive`
   is only a fallback lead; holding the last Counterspell through a win on
   the stack is a miss, while holding it through a random rock is not.
5. Sequencing vs. the stack: play the spell that needs to resolve before
   the one that needs mana open; do not tap out into a known answer if the
   primer would wait.
6. Politics: inspect `politics.references`, its `talk` / `deal` events, and
   the final deal status. Check whether an irreversible play should have
   opened negotiation, whether terms were legal and useful, and whether a
   seat honored, completed, expired, or explicitly breached an accepted
   deal. Never invent unrecorded table talk.
7. `flags.unexplained_holds` means a current-format pass left cards and mana
   without the required `think` / `decision`; classify it as incomplete
   replay evidence before calling the underlying play bad.
8. Rules-illegal or snapshot-incoherent events are **sim bugs**, not list
   or pilot lessons. Say that and stop grading the line.

Do not blame the 99 in Mode B unless the correct play was impossible
because the card was not in the deck. Put that under Mode A.

## 4. Report

Lead with the mode, the files, and the one-sentence verdict.

Mode A:

- Per-replay seat outcome for the focus deck.
- Recurring gaps (lands / ramp / interaction / draw / win pieces).
- Cards that looked bad, with why, and cards that looked unused but were
  correct holds.
- Sample-size caveat.

Mode B:

- Per seat, the worst two or three lines, each citing turn, event summary,
  recorded reason or deal when present, and the better legal play from cards
  then available.
- Flags the summarizer raised that you rejected, in one short list.

Featured cards in chat use small Scryfall images per
`.cursor/rules/card-chat-images.mdc`. Do not dump a 99-card gallery.

A table review does not authorize deck edits, primer rewrites, or a new
simulation. Offer those next steps; wait.
