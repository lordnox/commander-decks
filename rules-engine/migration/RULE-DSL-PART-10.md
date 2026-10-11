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

- [ ] schema and builders
- [ ] validation and capability advertisement
- [ ] durable payment/effect/reflexive execution
- [ ] host/headless/browser projection and resume paths
- [ ] focused and full validation

## Tests

To be filled as implementation proceeds.

## Remaining work

Part 11 owns resumable replacement lineage. This slice must preserve the
existing destination replacement and transaction semantics while keeping the
new program contexts independent of the live source.
