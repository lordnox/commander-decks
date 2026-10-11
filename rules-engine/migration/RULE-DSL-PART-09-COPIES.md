# Rule DSL Part 09 copies and legal retargeting

Status: implementation complete on the Part 09 copies review branch.

## Scope and base

This slice starts from the reviewed Part 09A modes head `2ddf37a0cf394d6b14eb180cc57f47fcdfeb6ec`.
It adds a distinct canonical `copySpell` instruction, preserving the pinned
execution context (definition revision, source capture, controller, X, modes,
occurrence scopes, and target bindings) when a stack spell is copied. It does
not run cast triggers or the casting lifecycle.

`copySpell` keeps the original target pins by default, including targets that
are now illegal. An explicit `chooseNewTargets` procedure first offers typed
keep/retarget choices, then uses a durable typed `selectCards` continuation;
answers are validated against the copied spell's pinned definition and the new
controller's legal recipients. Reconnect restores the same continuation without
refreshing old incarnations implicitly.

## Checkpoints

- [x] Add `copySpell` schema, builder, validator, and capability advertisement.
- [x] Copy a stack item as a semantic internal event with durable execution context.
- [x] Keep original target bindings and distinguish spell copies from casts.
- [x] Add explicit retargeting data and validation helper for only legal new choices.
- [x] Record the scope and durable typed continuation/restart behavior.
- [x] Remove completed spell-copy objects at resolution while leaving originals untouched.

## Validation

- `bun test rules-engine/src/cardPlugins/dsl/part09.copies.test.ts rules-engine/src/cardPlugins/dsl` — 0 failures.
- `bun run typecheck` — passed.
- `git diff --check` — passed.

The live host receives the keep/retarget offer and typed card-selection request
from the same private resolution frame. Invalid revision, seat, candidate, and
stale-identity answers are rejected before the parent resolution resumes.
