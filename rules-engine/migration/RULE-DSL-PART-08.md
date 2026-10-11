# Rule DSL Part 08 implementation note

Status: implementation in progress on `agent/gpt56luna-rule-dsl-part08`.

## Scope and base

This slice starts from Part 07 checkpoint `10ec6c902b3004c80dd3c7d9c5165a07d4b4f98d` and is rebased onto the approved Part 07 head `57e1d7f1ab7a3a65cd0546a4ed858472050e4b69`.
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
- [x] register canonical activation in the format path, pin its source and
  definition for canonical resolution, and execute a server activation
- [x] route canonical discard/sacrifice definitions through the real cast
  guards without duplicating legacy sacrifice events
- [x] validate and bind all canonical activation target clauses and honor
  declared available-from zones
- [x] execute canonical `addMana` instructions through the CR 605 activation
  path and include eligible restricted mana in authoritative payment plans
- [x] apply canonical nonmana costs before publishing the completed cast so
  cost-zone changes and their triggers precede cast occurrences

## Remaining work

Replacement-aware payment choice coverage belongs to Part 11, but this
transaction frame remains the insertion point for those choices. Legacy card
definitions continue to use their existing handlers while canonical definitions
now have authoritative target, restricted-mana, activation, and cost ordering
paths.

## Validation

- `tsc --noEmit` — passed.
- `bun test rules-engine/src/cardPlugins/dsl` — 69 passed, 0 failed.
- `bun test rules-engine` — 2,258 passed, 0 failed after canonical cast,
  activation, and nonmana cost integration.
- `check:imports` — passed.
- parent server review fixture — 9 passed, 0 failed (canonical activation,
  canonical life payment, Aether Tide X=0 and X=2 cast paths).
- `/Users/tobiaskopelke/projects/lordnox/commander-decks/node_modules/.bin/oxlint
  rules-engine live-runner site/src shared .agents/skills --quiet` — passed.
