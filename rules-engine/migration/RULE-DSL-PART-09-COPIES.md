# Rule DSL Part 09 copies and legal retargeting

Status: implementation complete on `agent/gpt56luna-rule-dsl-part09-copies`; awaiting parent review.

## Scope and base

This slice starts from Part 08 clean head `b87508d881c467a3602b08c5ee78a1f74fa355b6`.
It adds a distinct canonical `copySpell` instruction, preserving the pinned
execution context (definition revision, source capture, controller, X, modes,
occurrence scopes, and target bindings) when a stack spell is copied. It does
not run cast triggers or the casting lifecycle.

`copySpell` keeps the original target pins by default, including targets that
are now illegal. An explicit `chooseNewTargets` procedure is represented in the
canonical node and is rejected by the execution driver until a typed target
continuation supplies replacements. The exported validation helper checks those
replacements against the copied spell's pinned definition and current legal
recipients; it never refreshes old incarnations implicitly.

## Checkpoints

- [x] Add `copySpell` schema, builder, validator, and capability advertisement.
- [x] Copy a stack item as a semantic internal event with durable execution context.
- [x] Keep original target bindings and distinguish spell copies from casts.
- [x] Add explicit retargeting data and validation helper for only legal new choices.
- [x] Record the scope and remaining typed-continuation integration boundary.

## Validation

- `bun test rules-engine/src/cardPlugins/dsl` — 0 failures on the Part 08 suite.
- `git diff --check` — passed.

## Remaining work

The durable `copySpellTargets` offer/answer adapter must be wired into the
canonical selection protocol in the later host/choice integration pass. Until
then, canonical definitions may use `keep`; requesting `chooseNewTargets`
fails with a declaration-path error rather than silently selecting or refreshing
targets.
