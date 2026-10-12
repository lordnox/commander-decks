# Rule DSL Part 09: scoped modes and distributions

Status: implementation slice complete; integrated review candidate.

This slice is integrated on the approved Part08 base and carries the reviewed
mode, distribution, host transport, and resolution behavior through the live
runtime.

The canonical compiler now exposes pure helpers for announcement-time mode
cardinality, repeated mode occurrence scopes, and distributed allocations. Each
selected occurrence keeps a generated scope based on ability, mode, and
occurrence order. Allocation validation evaluates typed totals and minima (so a
shared `X` binding is checked once), requires one amount per local recipient,
checks the exact sum, and rejects missing allocations instead of guessing.

Resolution validates the selected mode list before constructing instruction
frames. Programs declaring distributions must carry the corresponding scoped
allocation records on the stack execution context; malformed sums, minima,
recipient cardinality, or scope/clause bindings fail before an instruction is
run. Existing trigger modal targeting and whole-item legality behavior remains
covered by the Part06/Part08 regression suite.

## Validation

- The Part09 durable runtime suite covers repeated scoped modes, printed order,
  activated and triggered cardinality, pinned sacrifice-cost counts,
  distributions, separate proliferate choices, and whole-item target gates.
- Host protocol and kernel action paths carry typed mode and distribution
  bindings; their checks run with the repository's full host validation.
- The full rules and type/import checks are recorded by the integrating review
  checkpoint.

## Scope note

Copy and retargeting preservation remains covered by the companion Part09
copies slice. This modes slice includes the Ashling's Command runtime ordering
exit: an Elemental copy is created before the later mode queries and damages
the controller's creatures, including the new token.
