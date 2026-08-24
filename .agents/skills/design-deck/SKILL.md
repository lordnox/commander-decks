---
name: design-deck
description: Grill a Commander brew before writing a 99. Use when the user wants to create, brew, or rebuild a Commander deck from a theme, commander, or constraint rather than from an already-complete list. Challenge commander choice, color identity, finishers, copy/mill math, Game Changers, tutors, and Oracle text before any decklist is saved.
---

# Design Deck

Do not write `decklist.txt` or a 99 until the grill below is answered. If the user already posted a complete list, skip this skill and follow `deck-workspace`.

## 0. Existing decks first

Inspect `decks/`. If a stored deck already matches the commander or theme, ask whether that is the deck before brewing a new one.

## 1. Grill, in this order

Ask only the questions that are still open. Challenge guesses instead of filling them in.

1. **Commander identity.** Why this commander and not the obvious neighbor (same colors, same verb)? What does the commander actually do on the stack and on later turns?
2. **Plan in one sentence.** What is the repeating action, and what ends the game? "Mill them" and "copy spells" are not a plan until the finisher card is named.
3. **Finishers.** Name the cards that win. For each one, read Oracle text from `scryfall-lookup` or the cache. Do not trust folk rules (for example: mill vs exile-until-N; copy vs "this spell"; Bruvac vs Tasha's Hideous Laughter).
4. **Math.** If the pitch is "N copies," walk one representative stack with Alania-style replacement, delayed triggers, and independent resolutions. If the pitch is mill/exile, estimate cards removed against cheap libraries; a stripped library is not always a win.
5. **Constraints.** Lock Game Changer count, tutor count, interaction density, cost reducers, and whether the user wants esoteric cards versus staples. Reject color-identity illegal suggestions immediately.
6. **Speed versus high roll.** Separate the gold-fish high roll from the expected win turn. A turn-four line that does not end the game is not a turn-four win.
7. **Name.** Infer `unrated_<kebab>` from the commander. Confirm only if identity is ambiguous.

Stop and wait when a constraint or Oracle reading would change the 99. Do not "just build it" to keep moving.

## 2. Build only after lock-in

Once commander, finishers, constraints, and math are agreed:

1. Follow `.agents/skills/deck-workspace/SKILL.md` (save list, resolve, categorize, primer, root README link).
2. Write `DECISIONS.md` with a `## Cards in` list of one `- **Card Name** — reason.` line per unique deck card. Record grill outcomes that are not inclusion reasons under `## Cards out`, `## Primer`, `## Rules`, or `## Talks`. Decisions are required, not optional.
3. Run `python3 .agents/skills/deck-workspace/scripts/validate_deck.py decks/<deck-name>` (decisions are required by default).
4. Use `assess-deck` only when the user asks for bracket or win-turn.

## Lessons this skill exists to keep

- Copy count is not kill count. Independent `Tasha's Hideous Laughter` copies each exile until mana value 20; lands are 0. Six copies do not empty a 99.
- `Bruvac, Grand Loquacious` doubles mill, not exile.
- `Goblin Anarchomancer` is Gruul and illegal in Izzet.
- Game Changer policy must be checked against the current Wizards list, not memory.
- High-roll sequences that strip libraries still need a damage finisher to end the game.
