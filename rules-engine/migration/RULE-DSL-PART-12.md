# Rule DSL Part 12 implementation note

Status: ready for review on `agent/rule-dsl-part12-prevention`.

## Scope

Consumable prevention instances (`GameState.preventionInstances`) with remaining
capacity, duration/deadline, recipient and source filters, CR 616 ordering
alongside canonical damage replacements, partial prevention on `dealDamage`,
full prevention when settled amount is zero, unpreventable damage, CR 615.12
life side effects, and static/`createEffect` DSL registration.

Immediate CR 615.12 follow-ups evaluate `count` / characteristic / variable
amounts in the source runtime context. `forTurns` deadlines use the pinned
`durationUntilTurn` from announcement rather than re-reading a constant count.

## Verification

```bash
bun test rules-engine/src/cardPlugins/dsl/part12.test.ts
bun run typecheck
bun run check:rule-dsl-coverage
```
