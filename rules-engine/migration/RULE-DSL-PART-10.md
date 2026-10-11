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
- [ ] host/headless/browser projection for the new payment offer
- [x] focused validation

## Tests

`bun run typecheck` and `bun test rules-engine/src/cardPlugins/dsl/part10.test.ts
rules-engine/src/cardPlugins/dsl/part09.copies.test.ts` pass. The Part 10 tests
cover immutable node compilation, generated/delayed ability source pins,
payment payer ownership, decline behavior, replaced payment destinations, and
reflexive program creation.

## Remaining work

Part 11 owns resumable replacement lineage. This slice preserves the existing
destination replacement and transaction semantics while keeping the new
program contexts independent of the live source. The browser currently uses
the existing typed option envelope for resolution payments; a dedicated compact
projection can be added in the host follow-up without changing the server
frame contract.
