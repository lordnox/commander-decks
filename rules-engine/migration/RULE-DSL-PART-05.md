# Rule DSL Part 05 implementation note

Status: implementation complete pending parent review on `agent/gpt56luna-rule-dsl-part05`.

## Scope and architecture

Part 05 closes the section-9 interaction contract around the existing kernel
choice machinery. The server remains the only owner of pending continuations:
the published request contains a generated request identity, stable revision,
chooser, phase/purpose/cancellation, and an authorized typed offer; an answer
contains only the request identity, revision, chooser, and typed selection data.
The host adapts card, player, and option answers to the existing typed kernel
events, while stack-target, mixed-target, order, and allocation contracts are
validated as data for the next action-family migrations.

The existing `TopdeckDecision` is the temporary host adapter during migration.
It carries the envelope and private offer projection, while the kernel continues
to own the real pending state. Each open request is registered in the persisted
`InteractionStore` snapshot with an immutable `TopdeckDecision` continuation.
The host converts the wire choice into a typed selection, looks up that stored
continuation, and dispatches the existing typed kernel event; it completes the
ledger only after dispatch succeeds. Rebuilding an offer after a restart uses
the pending kernel marker and the same request ID and revision. If a stale
reconstruction collides with an already registered occurrence, the host
allocates a fresh request occurrence and revision rather than rebinding an old
answer. Invalid answers leave the request open, and duplicate answers are
idempotent acknowledgements only when the submitted request, revision, seat,
choices, destinations, and order match the completed wire answer.
Mandatory choices remain open when a UI dialog closes. Concession clears the
chooser's pending request and lets the driver finish without waiting for a
departed seat.

## Checklist

- [x] Add the immutable envelope and typed offer/answer contracts.
- [x] Add validation for stack/mixed targets, options, ordering, and allocation.
- [x] Thread request metadata through the host's pending choice adapter.
- [x] Enforce freshness, authorization, immutable continuation lookup, and exactly-once answer consumption.
- [x] Add host-facing projection and waiting/ordinary-priority separation.
- [x] Add browser/headless envelope adapters and reconnect coverage.
- [x] Run focused host/protocol tests and full rules/host suites.

## Verification and open concerns

The envelope and immutable `InteractionStore` are implemented in
`shared/interaction.ts` and `rules-engine/src/interaction.ts`. The live host
persists request IDs, revisions, private candidate identities, immutable
continuations, and consumed answer fingerprints in `LobbyState`; reconnect uses
the same pending request, while same-named or moved objects invalidate it. Card
answers use typed `selectCards` with the pending selection identity, player
answers use typed `selectPlayers`, and option answers use typed option offers.
The public wire carries only opaque candidate handles and authorized request
metadata. `needsInput` suppresses ordinary priority actions and publishes an
awaiting seat. Concession clears the departed chooser's request and lets the
kernel settle.

Focused verification passes for the interaction store, protocol, wire codec,
browser request metadata, DSL compiler, reconnect, candidate identity, stale
occurrence, option bounds, cumulative-upkeep repetition, live host negative
answers, exact semantic duplicates, private projection, concession cleanup,
and browser-decoded/headless-equivalent answer paths. The full rules suite is
green at 2,220 tests / 7,125
assertions. The full host suite is green except for one known baseline failure:
generated card-handler import fixture resolution (`loads generated card handlers
from the current worktree`). The headless runner uses the same host path as the
browser envelope adapter; `CONDUIT.md` documents the required request ID and
revision on both clients. The wire codec test proves that the typed envelope,
source identity, phase, purpose, and cancellation survive a browser round-trip
and the host test proves the decoded answer produces the same journal and state
as the direct headless answer. Legacy card dialog events remain temporary
adapters for unmigrated action families; this part does not claim future
action-program families. Order is integrated for the existing Abundance
ordering selection; allocation and other future action families remain
contract-only until their kernel continuations exist.
