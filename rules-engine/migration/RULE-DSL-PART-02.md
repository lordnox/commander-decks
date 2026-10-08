# Rule DSL Part 02 implementation note

Part 02 adds rules-object incarnations, private execution contexts, captured
occurrences, and pure reference/selector/amount evaluation. The canonical DSL is
still not dispatched by the runtime; the capability descriptor continues to
report `runtimeExecution: false`.

## Object identity

Every engine-created `GameObject` starts at incarnation 1. Moving between zones
increments the incarnation. Reordering within a zone preserves it, while the
same-zone exceptions for exile (CR 400.8) and command (CR 400.10) create a new
incarnation by default. Callers can explicitly distinguish a reorder from a
same-zone new-object move. Phasing, control changes, face application, and copy
effects change the existing object without changing its incarnation.

CR 400.7 exceptions that let an effect find or retain information about a moved
card do not preserve the old object. That relationship must be represented by
captured occurrence data or an effect-specific link. The engine does not yet
model the CR 401.6 revealed-library transition as a general operation, nor does
it expose a general in-place transform event; the existing face and copy paths
are covered as characteristic changes.

Object targets are pinned to object ID, incarnation, and zone when their stack
item is created. A complete existing pin is retained by stack copies. Pre-stack
trigger target choices store the identities that were offered, so a card that
leaves and returns while the picker is open cannot be rebound. Part 04 still owns
canonical target clauses and the whole-item legality gate.

## Captured execution data

Stack items capture their controller separately from their source. The source
snapshot is refreshed to the last derived characteristics immediately before it
departs, including contexts waiting in card or player pickers. Trigger occurrences
capture their player, amount, before/after object snapshots, and attributed source
when those values exist. Ability and trigger programs placed on the stack are
deep-cloned so later source changes or mutable authoring templates cannot replace
the program that was activated or triggered.

Execution context is authoritative server state. It is serialized in journals
and saved games, but recursive projection removes it from stack payloads and
pending choices, including for the authorized chooser. Occurrences live only for
the stack item or continuation that needs them; there is no unbounded global event
or snapshot history.

The legacy instruction runtime still has self-action handlers that look up
`source.id` directly. Those handlers can therefore find a later incarnation after
a blink. Migrating those actions to context references belongs to the Part 03
driver and later card migration; this part does not claim that every legacy
self-action is identity-safe. Canonical captured snapshots are historical inputs,
not permission for a later action to affect a current object. Object-bound DSL
recipients resolve only when their pinned identity is still current.

## Evaluation boundary

The Part 02 evaluator enforces player, object, and stack-item domains, distinguishes
an absent binding from a declared empty binding, rejects invalid context domains,
and excludes internal action frames from stack selectors. Object groups and
format-owned opponent relations query current serialized state. Captured event
participants and source last-known information read their snapshots. Current
objects already carry the engine's derived continuous characteristics, so power,
toughness, mana value, and name predicates read that derived state without card
name dispatch.
