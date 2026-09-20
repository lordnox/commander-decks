---
name: plug-deck
description: >-
  Audit every card in one resolved Commander deck against the rules engine,
  first implement every missing reusable rule through implement-reviewed,
  then use a second implement-reviewed pass to register and test every card
  against those rules. Use when the user asks to plug in a deck, add engine
  support for all cards in a deck, reduce judge fallbacks, or prepare decks
  for fast live-table play.
disable-model-invocation: true
---

# Plug Deck

Make one stored deck playable by the rules kernel without routine judge-agent
fallbacks. This changes engine support, not the deck list. Work in two ordered
passes: finish reusable rules first, then add cards to the card pool. Do not
mix card registrations into the rules pass because doing so hides shared
capability gaps behind one-off card implementations.

## Input

Require one resolved `decks/<deck>/` workspace. If the deck is ambiguous, ask
for its directory. Run its existing validator before analyzing engine gaps.

Work in a dedicated branch and worktree. Different agents may run this skill
on different decks in parallel; each owns its branch and PR.

## Inventory

1. Read:
   - `rules-engine/DESIGN.md`
   - `rules-engine/src/types.ts`
   - built-in plugins under `rules-engine/src/plugins/`
   - `rules-engine/src/cardPlugins/`
   - `rules-engine/src/cardPlugins/cardRules.ts`
   - the deck's `cards.json` and `tokens.json`
2. Inventory every unique card by Oracle ID and current Oracle text. Basic
   lands normally classify as fully covered, but keep them in the completion
   checklist so "every card" remains literal and auditable.
3. Walk the complete inventory before implementing anything. Classify each
   card:
   - fully covered by built-in events/plugins
   - covered by an existing registered card handler
   - needs a reusable generic capability
   - needs card-specific behavior
   - ready to register after its dependencies exist
4. Turn every missing behavior into a deduplicated rules work list. Record
   which cards depend on each item so the later card-pool pass can prove that
   nothing was skipped.
5. Do not create handlers for text the kernel already represents. Prefer one
   generic capability over many name checks.

## Pass 1: implement missing rules

Read and invoke [`implement-reviewed`](../implement-reviewed/SKILL.md) with the
complete deduplicated rules work list. Split that list into independently
reviewable capabilities and order dependent capabilities explicitly. If the
list is empty, record that result and skip directly to Pass 2 rather than
starting an empty implementation run.

Each part in this pass adds a reusable engine capability and its tests. It does
not add the audited deck's names to `cardRules.ts`. A capability can include
the kernel, protocol, host, and UI changes required for one complete behavior;
those layers belong in one part when separating them would leave an unusable
half-path.

Use ordinary validated `GameEvent`s first.

- Generic rules belong in `rules-engine/src/plugins/`.
- Reusable odd Oracle behavior belongs in
  `rules-engine/src/cardPlugins/<camelCaseName>.ts`.
- Capability plugins read the effects stamped on the object, never its name.
  Search matchers stay in TypeScript; `newGame` stamps a clone-safe copy so
  `structuredClone` does not fail.

A plugin is not complete when it merely rejects priority or writes a
`players[seat].data` waiting marker. Any choice it introduces must have a full
path:

1. authoritative pending-choice state
2. private projection to only the choosing seat
3. protocol validation
4. UI selection
5. validated reducer events that consume the choice
6. resolution resumes and clears the marker
7. host restart restores the same choice without passing through it

Search, tutor, scry, surveil, discard, "may", modal, target, replacement, and
ordering effects need explicit choice tests. Never expose hidden library or
hand identities to another seat.

Use `judgeFallback` only to keep an already-running game alive while the
missing capability is being implemented. The finished plugin's normal tests
must not require a fallback.

After the reviewed rules branches are integrated, walk the complete card
inventory again against that result. If any card still reveals a missing
generic rule, add it to a new `implement-reviewed` rules iteration. Repeat this
audit → rules implementation → review cycle until the rules work list is
empty. Do not begin the card-pool pass before reaching this fixed point.

## Pass 2: add the cards to the card pool

Invoke [`implement-reviewed`](../implement-reviewed/SKILL.md) a second time,
now with the complete card inventory and the accepted rules result as its
base. Split the cards into reviewable parts while preserving the inventory as
the completion checklist. This pass wires cards to capabilities and tests
their exact Oracle behavior; it must not invent missing generic rules. If a
card exposes a real capability gap, stop this pass, return that work to Pass 1,
and restart the affected card part after the rule is accepted.

`rules-engine/src/cardPlugins/cardRules.ts` is the card-pool table, keyed by
English Oracle name. Add each card that needs declarative or handler-backed
behavior by composing builders there (`enters(selfMill(3))`,
`dies(selfMill(3))`, `entersTapped()`, `activate(...)`); static battlefield
grants use `staticGrant(pluginId)`. Handler ids are derived from those effects,
so nothing else has to be registered and no plugin keeps its own card-name
dictionary.

For every inventoried card, the reviewed result must identify one of:

- a new or existing `cardRules.ts` registration with exact-resolution tests
- existing registration and tests that already cover its current Oracle text
- no registration needed because built-in game rules completely cover it

Cards in the last category still belong in the completion checklist. Do not
add empty or name-only handlers merely to make them appear registered.

## Verify

For each new capability and card registration, test:

- legal and illegal event paths
- complete card resolution, not only the pause
- hidden-information projection
- host restart while a choice is open
- live host/UI integration when a human decision exists

Run:

```bash
bun test rules-engine live-runner site/src
bun run lint
bun run typecheck
bun run typecheck:live-runner
bunx vite build
```

Search the audited deck's card names against `needsPlugin`,
`judgeFallback`, and unresolved waiting markers. Report any remaining card
whose exact behavior still needs engine work; do not call the deck fully
plugged while that list is non-empty.

Preserve the two reviewed passes in the delivery history so reusable rules can
be reviewed separately from card wiring. Publish the final ready-for-review
result according to `implement-reviewed`. The PR body lists rules added,
card-pool entries added, cards requiring no entry, remaining gaps, and tests.
