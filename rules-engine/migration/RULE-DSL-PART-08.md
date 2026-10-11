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
- [x] route canonical optional and alternative cost selections through the
  server-owned announcement plan
- [x] apply canonical cost increases and generic reductions to the locked total
  and preserve that transaction through typed cost continuations
- [x] apply inline mana ability costs before canonical resolution and classify
  library movement by both source selector and destination
- [x] execute eligible mana-added triggers through the canonical inline driver,
  preserving JSON-resumable choices and ordering inline triggers after the
  producing mana ability completes
- [x] attach producer identities to legacy tap and mana-choice mana events so
  canonical mana-added patterns observe only eligible source events
- [x] apply the shared activation permission gate to real tap-for-mana and
  planner affordance callers, including active DSL activation prohibitions
- [x] route canonical mana sources selected by tap-for-mana through the pinned
  inline activation driver and add activation/resolution occurrence patterns
- [x] derive activation and resolution mana triggers from canonical source
  programs instead of client-supplied mana flags
- [x] emit one pinned completion occurrence after the full inline mana program,
  rather than treating each individual mana instruction as a resolution
- [x] honor prohibition object/player filter composition and inactive watcher
  state in the shared activation gate
- [x] replace the non-serializable canonical cost symbol with a server-created
  serializable transaction continuation, preserving locked costs and target
  identities through typed cost events and JSON restart
- [x] persist explicit planned mana payment frames across JSON restart, choice
  continuation, cancellation, invalid plans, and full-baseline rollback

## Remaining work

Replacement-aware payment choice coverage belongs to Part 11, but this
transaction frame remains the insertion point for those choices. Legacy card
definitions continue to use their existing handlers while canonical definitions
now have authoritative target, restricted-mana, activation, cost-plan, cost
ordering, and planned-payment continuation paths.

## Validation

- `bun test rules-engine/src/cardPlugins/dsl/part08.test.ts` — 26 passed, 0 failed, including locked adjusted-cost preservation, JSON restart, and full-baseline cancellation.
- `bun test rules-engine/src/plugins/mana.test.ts` — 20 passed, 0 failed.
- `bun test rules-engine` — 2,276 passed, 0 failed.
- TypeScript `--noEmit` — passed.
- `bun scripts/check-imports.ts` — passed.
- Parent payment review fixture — 53 checks passed.
- The known generated-host reload fixture remains outside this DSL slice.
