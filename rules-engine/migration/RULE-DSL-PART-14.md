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
- `remainingAfter` on multi-card draw proposals is preserved when a replacement
  program prevents the current slice.

## Gaps (deferred)

- Two Chains / empty-library failed-draw SBA / discard-destination replacement
  scenarios from RULE-DSL.md Q are not fully table-tested here.
- `replaceWith` programs beyond the Chains instruction mix (e.g. chooseInstructions)
  are untested in replacement frames.
- Draw-three multi-pause sequencing relies on remainder follow-ups; a dedicated
  three-discard integration test is still thin.

## Verification

```bash
bun test rules-engine/src/cardPlugins/dsl/part14.test.ts
bun test rules-engine/src/cardPlugins/dsl/part11.test.ts
bun run typecheck
bun run check:imports
```
