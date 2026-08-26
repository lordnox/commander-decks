---
name: design-deck
description: >-
  Grill a Commander brew before writing a 99. Use when the user wants to create,
  brew, or rebuild a deck from a theme, commander, or constraint rather than from
  a complete list. Ask the questions that would change the 99; verify Oracle and
  Game Changers; do not fill in guesses. Skip if the user already posted a list
  (use deck-workspace).
---

# Design Deck

Do not write `decklist.txt` or a 99 until the grill is locked. If the user already posted a complete list, skip this skill and follow `deck-workspace`.

This is a **discussion**. The job is the right questions and evidence-backed answers, then a list. Search with `scryfall-lookup` when a card or package would change the plan. Do not invent Oracle text.

## How to grill

- Ask only what is still open. Challenge guesses instead of filling them in.
- Prefer the user's constraint over a "better" staple they already refused.
- A right answer is Oracle (or `is:gamechanger`) plus the user's lock, not vibe.
- Stop and wait when a constraint or Oracle reading would change the 99.
- Do not "just build it" to keep moving.
- After lock-in, dump the argument into that deck's `DECISIONS.md` (`## Talks`, `## Rules`, maybeboard under `## Primer` or `## Cards out`). If the brew is parked instead of built, dump it into root `DECK-IDEAS.md`. Do not leave the grill only in chat.

## 0. Existing decks first

Inspect `decks/` and root `DECK-IDEAS.md`. If a stored deck already matches the commander or theme, ask whether that is the deck before brewing a new one. If the idea is already parked (especially under Currently not viable), do not rebuild it unless the user explicitly reopens it.

## 1. Grill, in this order

1. **Commander identity.** Why this commander and not the obvious neighbor (same colors, same verb)? What does it do on the stack and on later turns? If the theme must **not** sit in the command zone, say so and keep that card in the 99 or cut it.
2. **Plan in one sentence.** Repeating action, and what ends the game. Theme words ("aikido", "mill them") are not a plan until finishers are named.
3. **Finishers.** Name the cards that win. Read Oracle for each. Watch replacement effects, "this spell", mill vs exile, life-total **set** vs damage, and "your life total can't change" vs exchange.
4. **Math.** Walk one real stack or loop (costs, what Rings can copy, what is a mana ability). Fat-once is not infinite. A high-roll that does not end the game is not a win turn.
5. **How you find the finishers.** Tutors vs draw. Card tutors and land search are different locks. Game Changers: query `is:gamechanger`, do not trust memory (`Ancient Tomb`, `Mystical Tutor`, `Enlightened Tutor`, `Bolas's Citadel` have been GCs).
6. **Constraints.** Read the root `DECISIONS.md` card preferences first: esoteric old cards over staples, zero Game Changers unless this deck is excepted. Then colors, silence vs draw-go, sticky enchantments vs creatures, politics vs pillowfort, maybeboard vs 99. Reject color-identity illegal cards immediately.
7. **Speed versus high roll.** Gold-fish high roll vs expected win turn.
8. **Name.** Brew title and short commander slug. Folder `unrated_<commander>-<name>` (see AGENTS.md). Primer H1: `# [Commander](scryfall) — Title`. Confirm jokes and subtitles.

## 2. Build only after lock-in

1. Follow `deck-workspace` (save list, resolve, categorize, primer, tags, root README link).
2. Write `DECISIONS.md` as required by `deck-workspace` (How to use, Cards in, Talks for this grill). Put cards that lost the 99 but might return in a **Maybe** note, not under Cards in.
3. Validate with `validate_deck.py`.
4. Use `assess-deck` only when the user asks for bracket or win-turn.

## Lessons

Keep these; details and worked examples are in [lessons.md](lessons.md).

- Copy count is not kill count. `Tasha's Hideous Laughter` copies each exile until mana value 20; lands are 0.
- `Bruvac, Grand Loquacious` doubles mill, not exile.
- `Goblin Anarchomancer` is Gruul.
- Library-strip high rolls still need a way to deal damage or otherwise win.
- Life-total **exchange** is not Mister Negative's draw clause (draw only if you **lost** life). ETB exchange blinks; Magus/Mirror/Conduit do not swap on ETB.
- `Cabal Coffers` is a mana ability (Rings will not copy it). `Deserted Temple`'s untap targets, so Rings copies it. Loop net is `N − 5` black; need 6+ Swamps for positive mana.
- White "ramp" is mostly Plains **search**. That is land tutoring, not Cultivate. Fetches have empty color identity.
- `Teferi's Protection` (and similar) stop your life total from changing; do not pair them with an exchange on the same turn.
