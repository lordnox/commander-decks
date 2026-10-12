# Rule DSL Part 11 implementation note

Status: ready for review on `agent/rule-dsl-part11-replacements`.

## Scope

Part 11 replaces the kernel timestamp loop with applicability discovery, a
persisted `eventProcessing` frame, CR 616 category ordering, player modifier
choices, optional-decline ledgers, and lineage carried on replaceable events.
Legacy `plugin.replace` hooks remain adapters into the same processor; canonical
static `replacement` effects on pinned definitions are discovered from the
battlefield.

## Gaps (deferred)

- Full replacement program execution (branch/choose/suspend nodes beyond the
  frame shape) is typed but not yet driven for card content.
- Prevention shields and static layer integration remain Parts 12–13.
- Chains-specific draw history remains Part 14.

## Verification

```bash
bun test rules-engine/src/cardPlugins/dsl/part11.test.ts
bun test rules-engine/src/driver.test.ts
bun test rules-engine
```
