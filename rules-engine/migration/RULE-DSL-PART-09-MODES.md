# Rule DSL Part 09: scoped modes and distributions

Status: implementation slice complete; review pending.

This slice starts from the reviewed Part08 head `b87508d881c467a3602b08c5ee78a1f74fa355b6`.

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

- `bun test rules-engine/src/cardPlugins/dsl rules-engine/src/rules/dslTriggers.test.ts` — 90 passed, 0 failed.
- `bun run check:imports` — passed.
- `bun run typecheck` — unavailable in this worktree because `tsc` is not on PATH (the Part08 base recorded a passing typecheck).
- `bun run check:rule-dsl-coverage` — reports the pre-existing generated ledger is stale; no ledger was regenerated in this focused slice.

## Remaining work

Announcement UI/host wiring for spell and activation mode offers, copy and
retargeting preservation, and typed distribution pickers remain for the
follow-on Part09 copies/retargeting slice and later host integration.
