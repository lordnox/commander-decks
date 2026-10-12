# Rule DSL Part 10: temporary effects, resolution payments, and reflexive programs

## Base and scope

This slice is based on `de4f708` (`agent/gpt56luna-rule-dsl-part09-copies`). It
adds versioned canonical nodes for temporary effects, optional payments during
resolution, delayed and reflexive programs, and generated/granted abilities.
The nodes are validated, immutable, serialized with their parent definition
revision, and executable by the canonical resolution driver through durable
frames. Resolution payments have their own payer and decision checkpoint; they
do not reuse announcement ownership or open an ordinary priority window.

## Progress

- [x] schema and builders
- [x] validation and canonical resolution payment/effect frame helpers
- [x] canonical effect events and resolution payment choice/resume path
- [x] durable discard/sacrifice/life/mana payment cursor with typed card choices,
  payer checks, cast-only restricted-mana filtering, captured-X expansion,
  typed ordinary and canonical inline mana activation, scoped branches,
  atomic event settlement, and later reflexive checkpoint queuing
- [x] host/headless/browser projection for the new payment offer
- [x] durable delayed programs, including source/version pins and captured parent bindings
- [x] generated granted abilities with recipient-source triggering and typed targets
- [x] declared effect/grant deadlines, including source incarnations and turn/step expiry
- [x] focused validation for this effects/delayed scope

## Tests

`bun run typecheck` and the focused Part 10, Part 09 copy, delayed-trigger, and
compiler capability tests pass on this scope. The Part 10 tests cover immutable
node compilation, delayed execution after source departure and JSON restart,
captured parent target bindings, generated ability triggering with fresh typed
targets, source-incarnation expiry, and declared step/turn deadlines.
The payment path also covers payer ownership, decline behavior, replaced payment
destinations, captured-X mana, and a typed sacrifice selection with its paid
branch. Full Part 10 effect, delayed, and generated-ability coverage remains
with their owning slices.
The payment path also covers empty-pool inline mana activation, cast-only
restricted mana filtering, independent payers, modal scopes, prevented and
replaced sacrifice destinations, captured-X mana, JSON restart, and fresh
reflexive target announcements. Full Part 10 effect, delayed, and
generated-ability coverage remains with their owning slices.
The payment path also covers empty-pool inline mana activation, cast-only
restricted mana filtering, independent payers, modal scopes, prevented and
replaced sacrifice destinations, atomic multi-card rollback, life-loss
settlement, captured-X mana, JSON restart, and fresh reflexive target
announcements. Full Part 10 effect, delayed, and generated-ability coverage
remains with their owning slices.

## Remaining work

The remaining Part 10 integration includes the final resolution-payment path
and its host projections. Part 11 owns resumable replacement lineage. The
delayed and granted programs implemented here stay independent of a live source
frame and resume from their persisted snapshots and bindings.
