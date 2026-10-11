# Rule DSL Part 09 copies and legal retargeting

Status: implementation complete on `agent/gpt56luna-rule-dsl-part09-copies`; awaiting parent review.

## Scope and base

This slice starts from the reviewed Part 09A modes head `2ddf37a0cf394d6b14eb180cc57f47fcdfeb6ec`.
It adds a distinct canonical `copySpell` instruction, preserving the pinned
execution context (definition revision, source capture, controller, X, modes,
occurrence scopes, and target bindings) when a stack spell is copied. It does
not run cast triggers or the casting lifecycle.

`copySpell` keeps the original target pins by default, including targets that
are now illegal. An explicit `chooseNewTargets` procedure has a durable typed
retargeting offer/answer continuation backed by `InteractionStore`; answers are
validated against the copied spell's pinned definition and current legal
recipients, and reconnect restores the same continuation without refreshing old
incarnations implicitly.

## Checkpoints

- [x] Add `copySpell` schema, builder, validator, and capability advertisement.
- [x] Copy a stack item as a semantic internal event with durable execution context.
- [x] Keep original target bindings and distinguish spell copies from casts.
- [x] Add explicit retargeting data and validation helper for only legal new choices.
- [x] Record the scope and durable typed continuation/restart behavior.

## Validation

- `bun test rules-engine/src/cardPlugins/dsl/part09.copies.test.ts rules-engine/src/cardPlugins/dsl` — 0 failures.
- `bun run typecheck` — passed.
- `git diff --check` — passed.

## Remaining work

The generic host adapter still needs to project multi-clause replacement targets
through the live target picker; the server-side continuation and validation are
already durable and reject stale, wrong-seat, and forged answers.
