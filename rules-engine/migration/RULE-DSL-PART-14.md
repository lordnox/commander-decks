# Rule DSL Part 14 implementation note

Status: ready for review on `agent/rule-dsl-part14-draw-history`.

## Scope

- `drawStepTracking` on game state records per draw-step instances and actual
  cards drawn (extra draw steps bump a new instance).
- `wouldDraw` / `firstDrawInOwnDrawStep` matching in canonical replacement
  discovery and trigger occurrence filters uses that history; replaced non-draws
  do not consume the exemption.
- `replaceWith` runs through `replacement/instructionProgram.ts` (discard with
  `selectCards`, `if`, draw, mill, gainLife/loseLife) on `eventProcessing.program`.
- Lineage and used-instance ledgers from Part 11 carry into program-emitted events.
- `remainingAfter` on multi-card draw proposals is a fresh sibling draw: original
  remainder slices do not inherit the used-instance ledger. Only replacement-
  generated follow-up draws keep that lineage.
- Discard results are bound from replacement settlement of the discard event
  (prevented vs actually discarded), not from whether the answer listed object IDs.

## Gaps (deferred)

- Two Chains / empty-library failed-draw SBA scenarios from RULE-DSL.md Q are
  not fully table-tested here.
- `replaceWith` programs beyond the Chains instruction mix (e.g. chooseInstructions)
  are untested in replacement frames.

## Verification

```bash
bun test rules-engine/src/cardPlugins/dsl/part14.test.ts
bun test rules-engine/src/cardPlugins/dsl/part11.test.ts
bun run typecheck
bun run check:imports
```
