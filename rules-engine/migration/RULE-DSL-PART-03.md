# Rule DSL Part 03 implementation note

Part 03 of [`RULE-DSL-IMPLEMENTATION-PLAN.md`](../RULE-DSL-IMPLEMENTATION-PLAN.md)
adds the first durable runtime execution slice for the canonical Rule
DSL and repairs the legacy instruction driver so a resolving spell can suspend,
survive a restart, and resume from the exact instruction cursor. The capability
descriptor advertises only untargeted plain spell programs whose executable
instructions are `draw`, `gainLife`, `loseLife`, and structural `sequence`.
Targets, modes, distributions, payment choices, and whole-item legality remain
outside this slice.

## Durable resolution mechanics

Canonical spell frames pin the compiled definition snapshot, source execution
context, controller, declaration path, nested instruction scopes, cursor, and
pending events. Sequence instructions push a child scope and resume exactly
once. Legacy frames retain the stack item and its execution context while a
typed card, player, option, dialog, search, or payment choice is open. The
frame, pending choice, and pinned definition are JSON-journal data; projections
remove private execution details while retaining the chooser's permitted offer.

Each instruction commits its events before the driver prepares the next one.
Between committed instructions, the driver runs a recompute-only stabilization
pass; it does not collect state-based actions, place triggers, or restore
priority. The ordinary checkpoint then handles derived characteristics and
state-based actions after the complete resolution, so a temporary
zero-toughness or lethal state can be repaired by a later instruction in the
same resolution. Simultaneous state-based actions use one common pre-wave
snapshot. Pending triggers are placed only after the resolution checkpoint,
and an all-pass round resolves one stack item before priority is restored.

Source last-known information is refreshed immediately before departure for
execution contexts, trigger execution contexts, and active canonical or legacy
frames. Historical occurrence source snapshots remain immutable. Disposal uses
the original object incarnation, so a later blink or replacement cannot be
removed by an old frame. A destroyed targeted permanent records its controller
before the move for the supported controller-search instruction.

## Corrections recorded by this part

The legacy path now centralizes deferred completion events, keeps nested library
searches attached to the parent spell, and avoids duplicate `resolveTop`
continuations. Suspended frames reject ordinary priority actions and mana
changes; mana activity is accepted only for the currently pending payer and
payment. Choice offers are seat-checked and remain private across restart and
projection. Failed draws are marked for the post-resolution checkpoint rather
than opening a priority window during resolution.

The compatibility fixture and migration tests preserve the v0 open-choice
restore evidence. A few legacy assertions now explicitly model the corrected
timing: triggers wait for all APNAP choices, modal stack items resolve one at a
time, completed instant and sorcery spells leave the stack, and an unresolved
choice does not permit an unrelated land tap.

## Deferred work

Part 04 owns canonical target clauses, whole-item target legality, and broader
object-target execution. Later parts own offers, APNAP payment protocol,
reusable actions, modes, distributions, and additional canonical instruction
families. General revealed-library transitions, arbitrary in-place transforms,
and full legacy self-action identity migration remain deferred. The temporary
legacy resolution frame is retained only as the compatibility route while those
surfaces migrate; it is not a permanent old-format compatibility contract.

This note records implementation status only. The Part 03 plan is accepted by
the parent reviewer separately; no acceptance marker is added here.
