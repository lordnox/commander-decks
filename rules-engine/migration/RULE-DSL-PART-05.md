# Rule DSL Part 05 implementation note

Status: implementation in progress on `agent/gpt56luna-rule-dsl-part05`.

## Scope and architecture

Part 05 closes the section-9 interaction contract around the existing kernel
choice machinery. The server remains the only owner of pending continuations:
the published request contains a generated request identity, monotonic revision,
chooser, phase/purpose/cancellation, and an authorized typed offer; an answer
contains only the request identity, revision, chooser, and typed selection data.
The host adapts card and player answers to the existing `selectCards` and
`selectPlayers` events, while new stack-target, mixed-target, option, order, and
allocation contracts are validated as data before any kernel event is emitted.

The existing `TopdeckDecision` is the temporary host adapter during migration.
It will carry the same envelope metadata and private offer projection, while the
kernel continues to own the real pending state. Rebuilding an offer after a
restart uses the pending kernel marker and the same request ID; no continuation
or executable payload is accepted from a client. Valid answers are consumed once
by the host request ledger, invalid answers leave the request open, and duplicate
answers are idempotent acknowledgements. Mandatory choices remain open when a UI
dialog closes. Concession clears the chooser's pending request and lets the driver
finish without waiting for a departed seat.

## Checklist

- [x] Add the immutable envelope and typed offer/answer contracts.
- [x] Add validation for stack/mixed targets, options, ordering, and allocation.
- [x] Thread request metadata through the host's pending choice adapter.
- [x] Enforce freshness, authorization, and exactly-once answer consumption.
- [x] Add host-facing projection and waiting/ordinary-priority separation.
- [x] Add browser/headless adapter coverage and reconnect coverage.
- [ ] Run focused host/protocol tests and full rules/host suites.

## Current verification and open concerns

The envelope and immutable `InteractionStore` are implemented in
`shared/interaction.ts` and `rules-engine/src/interaction.ts`. The live host
persists request IDs, revisions, private candidate identities, and consumed
answer fingerprints in `LobbyState`; reconnect reuses the same pending request,
while same-named or moved objects invalidate it. Card answers continue through
typed `selectCards` (now carrying the pending selection identity) and player
answers through typed `selectPlayers`; the public wire carries only opaque
candidate handles and authorized request metadata. `needsInput` suppresses
ordinary priority actions and publishes an awaiting seat. Concession clears the
departed chooser's request and lets the kernel settle.

Focused verification passes for the interaction store, protocol, wire codec,
browser request metadata, DSL compiler, reconnect, candidate identity, and
live host choice paths. The
full host suite has one known baseline failure: generated card-handler import
fixture resolution (`loads generated card handlers from the current worktree`).
The live host's persisted `LobbyState` is the authoritative continuation lookup
for the current migration adapter; `InteractionStore` supplies the same
immutable reservation/complete/reject semantics for headless callers and saved
request records. The browser now submits the request ID/revision, and the
explicit legacy adapter accepts only an answer with both metadata fields absent;
partially populated metadata is rejected. The legacy `custom` paths remain temporary adapters for
unmigrated card dialogs and are not used by the new typed contracts. The
remaining Part 05 concern is retiring those adapters as their owning parts
migrate; this part does not claim future action-program families.
