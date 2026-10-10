# Rule DSL Part 07 implementation note

Status: ready for parent review on `agent/gpt56luna-rule-dsl-part07`.

## Scope delivered

Part 07 extends the v1 instruction union and builders with semantic action
primitives for sacrifice, movement, phasing, proliferate, token creation,
copy, and counter placement. The canonical driver emits typed kernel events
for those actions, plus distinct `mill` and `destroy` events; damage remains a
`dealDamage` event with its captured source snapshot, so prevention, lifelink,
infect, and attribution continue through the existing damage pipeline.

Resolution scopes remain data-only and nested. Conditional programs select a
branch through the shared canonical condition evaluator, then push a durable
child scope before the next action is prepared. Count-based discard gathers
private typed choices for every affected player before committing one action
group; selected-card discard remains its own form. Empty action groups and
hands do not create impossible pickers. Simultaneous recipients are gathered
into one instruction event group with common trigger before-state.

## Choice boundary

Instruction programs open the existing server-owned `selectOption` envelope,
and card choices open typed `selectCards` offers. Answers bind selected object
incarnations into the private frame before the next nested scope resumes;
selected-card discard remains distinct from player/count discard. Empty optional
groups bind an empty choice without opening an impossible picker. No canonical
choice routes through `custom` or trusts client labels.

## Evidence so far

- `./node_modules/.bin/tsc --noEmit` — passed.
- `bun test /private/tmp/rule-dsl-part07-parent-review.test.ts` — 4 passed, 0 failed.
- `bun test rules-engine` — 2,234 passed, 0 failed.
- `bun run check:imports` and `bun run typecheck:live-runner` — passed previously
  on the same stack; rerun if the parent changes Part 06.
- `bun test live-runner/src/kernelHost.test.ts` — 87 passed; 1 failure remains
  the documented generated-handler fixture in `KNOWN-TEST-FAILURES.md`.
- Existing generated-handler live-runner fixture limitation remains recorded in
  `KNOWN-TEST-FAILURES.md`; no new baseline failure is accepted here.

## Rules references

The semantic separation follows CR 701 (keyword actions), CR 704 (state-based
actions), CR 609/615 (replacement and prevention entry points), and CR 121.2
(draws are separate events). Exact trigger/checkpoint behavior remains owned by
Parts 06 and later replacement work.
