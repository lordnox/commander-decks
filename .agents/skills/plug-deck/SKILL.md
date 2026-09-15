---
name: plug-deck
description: >-
  Audit every card in one resolved Commander deck against the rules engine,
  implement missing reusable card plugins and decision UI, and test complete
  resolution paths. Use when the user asks to plug in a deck, add engine
  support for all cards in a deck, reduce judge fallbacks, or prepare decks
  for fast live-table play.
disable-model-invocation: true
---

# Plug Deck

Make one stored deck playable by the rules kernel without routine judge-agent
fallbacks. This changes engine support, not the deck list.

## Input

Require one resolved `decks/<deck>/` workspace. If the deck is ambiguous, ask
for its directory. Run its existing validator before analyzing engine gaps.

Work in a dedicated branch and worktree. Different agents may run this skill
on different decks in parallel; each owns its branch and PR.

## Audit

1. Read:
   - `rules-engine/DESIGN.md`
   - `rules-engine/src/types.ts`
   - built-in plugins under `rules-engine/src/plugins/`
   - `rules-engine/src/cardPlugins/`
   - `cards/rules-plugins.json`
   - the deck's `cards.json` and `tokens.json`
2. Inventory every unique non-basic card by Oracle ID and current Oracle text.
3. Classify each card:
   - fully covered by built-in events/plugins
   - covered by an existing registered card handler
   - needs a reusable generic capability
   - needs card-specific behavior
4. Do not create handlers for text the kernel already represents. Prefer one
   generic capability over many name checks.

## Implement

Use ordinary validated `GameEvent`s first.

- Generic rules belong in `rules-engine/src/plugins/`.
- Reusable odd Oracle behavior belongs in
  `rules-engine/src/cardPlugins/<camelCaseName>.ts`.
- Register static battlefield effects under `pluginIds`.
- Register always-on cast, resolution, activated, or triggered handlers under
  `handlerIds`.
- Key `cards/rules-plugins.json` by Oracle ID and preserve other agents'
  entries while rebasing.

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

## Verify

For each new capability, test:

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

Commit coherent capabilities separately, push, and open a ready-for-review PR.
The PR body lists generic capabilities added, card handlers added, remaining
gaps, and tests.
