# Rule DSL Part 09 copies and legal retargeting

Status: implementation complete on the Part 09 copies review branch.

## Scope and base

The combined Part 09 PR is based on the reviewed Part 08 head
`a18ab7d517041be903ba01babec2a6babe3eb1ce`. It adds a distinct canonical
`copySpell` instruction and preserves the original definition revision, X,
selected modes, occurrence scopes, allocations, and target bindings. The copy
captures its own stack object as `execution.source` and uses the copy
controller, so source-based effects resolve from the copy. It does not run cast
triggers or the casting lifecycle.

`copySpell` keeps the original target pins by default, including targets that
are now illegal. An explicit `chooseNewTargets` procedure first offers typed
keep/retarget choices, then uses durable typed player, card, and stack pickers.
Each answer validates the slots already fixed in that job, allowing legal
target swaps while later slots are still unanswered. The final answer validates
the complete target set against the selected mode clauses, scoped cross-constraints,
and distinctness rules before the copy is created. Each original binding keeps its original recipient count even when
live board values change. An unchanged illegal pin is exempt only at its exact
original slot; a changed slot is checked independently. Reconnect restores the
same per-controller, per-slot continuation, and completed copy jobs are removed
after their result is recorded.

## Checkpoints

- [x] Add `copySpell` schema, builder, validator, and capability advertisement.
- [x] Copy a stack item as a semantic internal event with durable execution context.
- [x] Keep original target bindings and distinguish spell copies from casts.
- [x] Add explicit retargeting data and complete replacement validation for only legal new choices.
- [x] Record per-slot scope and durable typed continuation/restart behavior.
- [x] Remove completed spell-copy objects at resolution while leaving originals untouched.

## Validation

- `bun test rules-engine/src/cardPlugins/dsl/part09.copies.test.ts` — 11 tests, 0 failures.
- `bun test rules-engine/src/cardPlugins/dsl/part09.test.ts` — 15 tests, 0 failures.
- `bun run typecheck` — passed.
- `bun run check:imports` — passed.
- `bun run test:rules` — 2,303 tests passed, 7,391 assertions.
- `git diff --check` — passed.

The live host receives the keep/retarget offer and typed picker request from the
same private resolution frame. Invalid revision, seat, candidate, duplicate,
cross-clause, and stale-identity answers are rejected before the parent
resolution resumes. Restarted per-slot jobs retain their original cardinality,
scope, and mode bindings, while completed copy jobs are consumed before later
instructions continue.
