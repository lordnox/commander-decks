# Rule DSL Part 09 copies and legal retargeting

Status: implementation complete on the Part 09 copies review branch.

## Scope and base

This slice starts from the reviewed Part 09 modes and allocations head
`14b062c33bf7880aefdda1947676463d895eb407`. It adds a distinct canonical
`copySpell` instruction and preserves the original definition revision, X,
selected modes, occurrence scopes, allocations, and target bindings. The copy
captures its own stack object as `execution.source` and uses the copy
controller, so source-based effects resolve from the copy. It does not run cast
triggers or the casting lifecycle.

`copySpell` keeps the original target pins by default, including targets that
are now illegal. An explicit `chooseNewTargets` procedure first offers typed
keep/retarget choices, then uses durable typed player, card, and stack pickers.
Every replacement validates the complete target set against the selected mode
clauses, scoped cross-constraints, and distinctness rules before the picker
advances. Each original binding keeps its original recipient count even when
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

- `bun test rules-engine/src/cardPlugins/dsl/part09.copies.test.ts` — 9 tests, 0 failures.
- `git diff --check` — passed.

The live host receives the keep/retarget offer and typed picker request from the
same private resolution frame. Invalid revision, seat, candidate, duplicate,
cross-clause, and stale-identity answers are rejected before the parent
resolution resumes. The repository-wide typecheck still reports the unrelated
pre-existing allocation-choice union errors in `canonicalAnnouncement.ts` and
the live-runner handler preparation; the Part 09 copy tests and focused
compiler/rules checks pass.
