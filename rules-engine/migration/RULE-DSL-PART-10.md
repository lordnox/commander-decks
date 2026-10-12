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

## Remaining work

The remaining Part 10 integration includes the final resolution-payment path
and its host projections. Part 11 owns resumable replacement lineage. The
delayed and granted programs implemented here stay independent of a live source
frame and resume from their persisted snapshots and bindings.
