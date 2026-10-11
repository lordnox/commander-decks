# Rule DSL Part 08 implementation note

Status: implementation in progress on `agent/gpt56luna-rule-dsl-part08`.

## Scope and base

This slice starts from Part 07 checkpoint `10ec6c902b3004c80dd3c7d9c5165a07d4b4f98d`.
It adds a data-only announcement transaction boundary for validating complete
proposals, locking costs, and recording mana-payment plans. The boundary is
provisional until commit, so suspended, invalid, or cancelled announcements
cannot publish payments, targets, or cast occurrences.

## Checkpoints

- [x] define typed cost plans and transaction frames
- [x] validate target/payment uniqueness and full payment
- [x] expose read-only `prepareAction` offers without claiming execution support
- [x] cover mana-ability classification and activation permission checks
- [x] add rollback, atomic commit, and payment-frame tests
- [x] run rules/type/import checks and record remaining limitations

## Remaining work

Integration with every legacy cast and activation route remains a later
migration concern. Replacement-aware payment choice coverage belongs to Part 11,
but this transaction frame must remain the insertion point for those choices.

## Validation

- `tsc --noEmit` — passed.
- `bun test rules-engine/src/cardPlugins/dsl` — 69 passed, 0 failed.
- `bun test rules-engine` — 2,258 passed, 0 failed after canonical cast,
  activation, and nonmana cost integration.
- `check:imports` — passed.
- `/Users/tobiaskopelke/projects/lordnox/commander-decks/node_modules/.bin/oxlint
  rules-engine live-runner site/src shared .agents/skills --quiet` — passed.
