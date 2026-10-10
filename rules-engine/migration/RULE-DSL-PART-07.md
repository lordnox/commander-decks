# Rule DSL Part 07 implementation note

Status: implementation in progress on `agent/gpt56luna-rule-dsl-part07`.

## Scope delivered

Part 07 extends the v1 instruction union and builders with semantic action
primitives for sacrifice, movement, phasing, proliferate, token creation,
copy, and counter placement. The canonical driver emits typed kernel events
for those actions, plus distinct `mill` and `destroy` events; damage remains a
`dealDamage` event with its captured source snapshot, so prevention, lifelink,
infect, and attribution continue through the existing damage pipeline.

Resolution scopes remain data-only and nested. Conditional programs select a
branch by evaluating their typed condition against the current frame result and
amount bindings, then push a durable child scope before the next action is
prepared. Empty action groups return no events and therefore do not create a
choice or priority window. Simultaneous recipients are gathered into one
instruction event group before the driver commits the group.

## Choice boundary

Instruction programs open the existing server-owned `selectOption` envelope,
and card choices open typed `selectCards` offers. Answers bind selected object
incarnations into the private frame before the next nested scope resumes;
selected-card discard remains distinct from player/count discard. Empty optional
groups bind an empty choice without opening an impossible picker. No canonical
choice routes through `custom` or trusts client labels.

## Evidence so far

- `./node_modules/.bin/tsc --noEmit` — passed.
- `bun test rules-engine/src/cardPlugins/dsl rules-engine/src/driver.test.ts` — 63 passed, 0 failed.
- `bun test rules-engine` — 2,233 passed, 0 failed.
- `bun run check:imports` — passed.
- `bun run typecheck:live-runner` — passed.
- `bun test live-runner/src/kernelHost.test.ts` — 87 passed; 1 failure is the
  documented generated-handler fixture in `KNOWN-TEST-FAILURES.md`.
- Existing generated-handler live-runner fixture limitation remains recorded in
  `KNOWN-TEST-FAILURES.md`; no new baseline failure is accepted here.

## Rules references

The semantic separation follows CR 701 (keyword actions), CR 704 (state-based
actions), CR 609/615 (replacement and prevention entry points), and CR 121.2
(draws are separate events). Exact trigger/checkpoint behavior remains owned by
Parts 06 and later replacement work.
