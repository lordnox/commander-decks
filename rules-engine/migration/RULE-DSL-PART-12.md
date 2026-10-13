# Rule DSL Part 12 implementation note

Status: ready for review on `agent/rule-dsl-part12-prevention`.

## Scope

Consumable prevention instances (`GameState.preventionInstances`) with remaining
capacity, duration/deadline, recipient and source filters, CR 616 ordering
alongside canonical damage replacements, partial prevention on `dealDamage`,
full prevention when settled amount is zero, unpreventable damage, CR 615.12
life side effects, and static/`createEffect` DSL registration.

## Verification

```bash
bun test rules-engine/src/cardPlugins/dsl/part12.test.ts
bun run typecheck
```
