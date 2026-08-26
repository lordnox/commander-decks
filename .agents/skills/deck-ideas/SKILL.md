---
name: deck-ideas
description: >-
  Park grilled Commander brews in root DECK-IDEAS.md under Queued or Currently
  not viable. Use when the user parks an idea, says a brew is not viable or
  funny-but-worse, wants an unbuilt maybe list, or after design-deck when the 99
  is not locked. Do not use to write decklist.txt (that is deck-workspace).
---

# Deck Ideas

Write parked brews to root `DECK-IDEAS.md`. Do not create `decks/` or `decklist.txt`. House rules in root `DECISIONS.md` still apply if the idea is promoted later.

Grill first with `design-deck` when the plan is still open. This skill is the dump: the argument must not live only in chat.

## 1. Read before writing

Inspect `decks/` and `DECK-IDEAS.md`. If a stored deck already matches, ask whether that is the deck. If the same idea is already parked, update that entry instead of adding a second one. Do not rebuild a **Currently not viable** idea unless the user explicitly reopens it.

Create `DECK-IDEAS.md` if it is missing, using this skeleton, then link `[Deck ideas](DECK-IDEAS.md)` from the root README next to House rules:

```markdown
# Deck Ideas

Parking lot for grilled Commander brews that are not a stored 99. Each deck still has its own primer and `DECISIONS.md`. [House rules](DECISIONS.md) still apply if an idea is promoted.

## How to use

- **Queued** — worth grilling or building when someone asks.
- **Currently not viable** — funny or on-theme, but not worth a folder. Read this before proposing the same 99 again.
- Move an idea between sections; delete it when it becomes a deck under `decks/`.

## Queued

_None._

## Currently not viable

_None._
```

Keep those two `##` headings. Do not invent a third slot unless the user names it.

## 2. Choose the slot

Ask if it would change the heading. Defaults:

| User said | Slot |
| --- | --- |
| park it, maybe later, queue it, worth a 99 someday | **Queued** |
| not viable, funny but worse, better options exist, do not build | **Currently not viable** |

## 3. Write the entry

Use `scryfall-lookup` for names. Link cards as `[Card Name](scryfall_uri)` like a primer. Do not embed card images.

Replace `_None._` in that section when adding the first entry. Put `_None._` back when a section has no remaining `###` entries.

Template:

```markdown
### Short title (theme)

Parked YYYY-MM-DD. Why this slot. Oracle-backed plan in a few sentences (repeating action, why it is or is not a loop). Named finishers that were considered. Commander lock, or that it was never locked. What a replacement 99 would need to keep doing, or why blue/the colors already do this better.
```

Date is today's date from user_info. Title is the brew joke or engine pair, not a commander slug unless that was locked.

Do not leave a 99-shaped maybeboard under `## Cards in` of a deck that was never created.

## 4. Promote or drop

- **Build:** delete the entry (restore `_None._` if the section is empty), then follow `design-deck` / `deck-workspace`.
- **Move slots:** cut the whole `###` block; do not duplicate.
- **Drop:** delete the entry. Do not keep a tombstone.

## 5. Done

Commit the `DECK-IDEAS.md` (and README link if new) on the session worktree. Confirm in chat which heading the idea landed under.
