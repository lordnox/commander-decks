# Rule DSL implementation plan

Status: proposed implementation backlog; this document does not change runtime behavior.

Source contract: [RULE-DSL.md](RULE-DSL.md), especially sections 11–14.
Baseline: `origin/main` at `f3edccb17143004e423141013ad6d8fed8a2c15a`.
Re-inventory against the implementation branch before starting.
Prepared: 2026-10-08.

Implement the DSL as a staged refactor of the existing authoritative engine, host,
and client. Preserve supported mechanics, move decision handling to server-owned
offers and continuations, and converge on one execution driver. The DSL document
defines the API target; [the repository's rules source](../rules-sources/README.md)
and its [official Comprehensive Rules download](https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt)
define rules behavior. Close incomplete schemas in the slice that introduces them.

## Scope and approach

The work includes versioned definitions and builders, references and amounts,
trigger collection, stack resolution, targeting, casting and activation costs,
modes, reusable instructions, replacements, prevention, static effects, and
browser/headless decision handling. It also includes migration of every currently
supported card/mechanic and deterministic persistence/replay for the new DSL.

Keep existing combat, mana, hidden-information, and continuous-effect code wherever
its behavior meets the contract. Add reusable semantics before registering a card.
No Oracle-text parser, arbitrary executable predicates, or new generic card-specific
dispatcher is needed. Broad support for previously unsupported Magic mechanics is
outside this refactor unless required to preserve existing coverage or implement
the document's conformance scenarios.

### Non-production migration policy

This product is not in production. There are no external legacy clients, saved
games, commands, or replays that the completed refactor must continue to support.
This policy supersedes backward-compatibility requirements elsewhere in this plan
and the source contract for pre-DSL formats.

Legacy adapters, helper wrappers, decoders, and execution routes are temporary
migration scaffolding. Keep them only while unmigrated cards or development tools
still need them; remove them during Part 16, including
`src/cardPlugins/dsl/builders/legacy.ts`. The finished product has one canonical
DSL representation and execution path, with no legacy compatibility layer.

Old development command, saved-state, and replay formats may be replaced outright.
Update their producers and consumers together; obsolete fixtures may be retired
or rewritten against the new format. Unsupported old payloads must fail clearly
rather than be silently reinterpreted. Do not build permanent upgrade adapters
solely to preserve those development artifacts.

Preserve supported gameplay behavior and its regression evidence throughout the
migration, apart from explicit tested rules corrections. New DSL state still
requires deterministic replay, private projection, durable continuation restore,
and exact schema/content pins for active programs; dropping old-format support
does not remove those requirements.

Use an additive, versioned DSL entry point during migration rather than changing
legacy helper signatures in place. Legacy `enters(...)` returns an effect; new
occurrence-pattern builders belong in `dsl/v1` or `events`. Legacy `to` recipients adapt to canonical
`targets`. Selectors and instruction recipient fields do not declare targeting;
only `decisions.targets` does.

## What already exists and what needs changing

| Area | Existing implementation | Required work |
| --- | --- | --- |
| Authoring | [effectDefinitions.ts](src/cardPlugins/effectDefinitions.ts), [effects.ts](src/cardPlugins/effects.ts), role-specific builder modules | Add versioned canonical definitions and validation; use temporary helper adapters during migration and remove them in Part 16. |
| Player groups | [selectors/players.ts](src/cardPlugins/selectors/players.ts), [instructions.ts](src/cardPlugins/instructions.ts), [resources.ts](src/cardPlugins/instructionHandlers/resources.ts) | Retain fixed player effects; add object/stack domains, references, and typed amounts. |
| Registry and discovery | [cardRules.ts](src/cardPlugins/cardRules.ts), [index.ts](src/cardPlugins/index.ts), [effectRuntime.ts](src/cardPlugins/effectRuntime.ts) | Store canonical definitions and derive capability/plugin requirements without card-name execution checks. Include token, copied, face, and granted definitions. |
| Identity and context | [types.ts](src/types.ts), [draft.ts](src/draft.ts), [rules/actions.ts](src/rules/actions.ts) | Existing object targets contain only object IDs. Add incarnation, scoped targets, captured controller, source snapshots, and pinned definition versions. |
| Execution | [runInstructions.ts](src/cardPlugins/runInstructions.ts), [instructionHandlers/](src/cardPlugins/instructionHandlers/), [plugins/spells.ts](src/plugins/spells.ts) | Generalize remaining-instruction continuations into durable program/event frames; retain resolving items until completion. |
| Event reduction | [kernel.ts](src/kernel.ts) | Separate event application from driver checkpoints. Current nested reductions run SBA processing and sorted replacement discovery; neither is the target execution contract. |
| Triggers and priority | [rules/triggers.ts](src/rules/triggers.ts), [plugins/priority.ts](src/plugins/priority.ts) | Replace immediate per-event placement and deterministic same-seat ordering with checkpoint-owned pending triggers and typed player ordering. Separate chooser from priority holder. |
| Targets and modes | [targetedResolve.ts](src/cardPlugins/targetedResolve.ts), [activated.ts](src/cardPlugins/activated.ts), [modalSpell.ts](src/cardPlugins/modalSpell.ts) | Replace per-effect/positional resolution checks with a whole-item gate and scoped bindings. Move modal choices from legacy resolution fallback to announcement. |
| Choices | [selectCards.ts](src/rules/selectCards.ts), [selectPlayers.ts](src/rules/selectPlayers.ts), [selectOptions.ts](src/rules/selectOptions.ts), [pendingDialog.ts](src/pendingDialog.ts) | Keep typed selections and authorization checks; introduce one request envelope, continuation store, and exactly-once answer handling. |
| Modifiers | [replacements.ts](src/cardPlugins/replacements.ts), [staticEffects.ts](src/cardPlugins/staticEffects.ts), [continuousEffects.ts](src/cardPlugins/continuousEffects.ts) | Add player-selected replacement processing, lineage and shields; audit layer/dependency/timestamp machinery rather than assuming it is complete. |
| Draw history | [rules/draw.ts](src/rules/draw.ts), [plugins/turnStructure.ts](src/plugins/turnStructure.ts) | Existing history is per turn; add step-instance history. Replace immediate empty-library loss marking with the required deferred failed-draw handling. |
| Host and client | [kernelChoicePrepare.ts](../live-runner/src/kernelChoicePrepare.ts), [kernelChoiceApply.ts](../live-runner/src/kernelChoiceApply.ts), [protocol.ts](../live-runner/src/protocol.ts), [LivePage.tsx](../site/src/LivePage.tsx), [TopdeckDialog.tsx](../site/src/TopdeckDialog.tsx) | Adapt current specialized choice stages to declarative offers; stop inferring rules from labels or card-specific pending payloads. |
| Persistence/projection | [journal.ts](src/journal.ts), [runtime.ts](src/runtime.ts), [kernelHost.ts](../live-runner/src/kernelHost.ts), [shared/liveTypes.ts](../shared/liveTypes.ts) | Replace development state/command formats and update consumers together; persist execution contexts, redact requests/results/traces, and replay new DSL decisions deterministically. |

The focused baseline run passed **53 tests across seven files**, with no failures:
`playerEffects`, `generalizedTriggers`, `runInstructions`, `selectCards`,
`selectPlayers`, `journal`, and `priority`. These establish existing behavior,
not full DSL conformance. Part 00 captures the broader baseline and known gaps.

## Architecture decisions to fix before implementation

1. **Definition and instance separation.** Implement the section-14 module structure
   under `src/cardPlugins/dsl/`: `v1/index.ts`, `schema/v1.ts`, `builders/`,
   `compiler/`, and `sugar/` with action families and composition helpers.
   The compiler generates declaration paths in a fixed definition revision.
   Authors supply no card/ability/effect/clause IDs; local choice/result bindings
   are scoped variables. Keep registration metadata separate from rule nodes.
2. **Versioning.** Schema version 1 describes node shape; a separate immutable
   definition revision identifies exact content. Frames pin both. Persist the
   definitions needed for replay or retain a versioned catalogue; resolve the
   storage choice in Part 01. A schema-version number alone cannot pin behavior.
3. **Execution state.** Add authoritative announcement, checkpoint, resolution,
   and event-processing frames with typed cursors, nested scopes, choices/results,
   and pending requests. Runtime contexts hold data, never callbacks or live
   `Draft` references. Keep private frame data out of client projections.
4. **One owner for progression.** A driver advances until `needsInput`, `priority`,
   or `ended`. Low-level reducers apply events without implicitly granting
   priority or running ordinary SBAs inside resolution. Nested casting and mana
   payment use explicit child frames, not a second independent resolution engine.
5. **Semantic actions and occurrences.** Distinguish proposed actions, replaceable
   component events, actual before/after occurrences, and action outcomes.
   Preserve simultaneity groups and event lineage. A parent action's success is
   not inferred from its original destination or a low-level trace count.
6. **Protocol.** Close `InteractionRequest`, every offer/answer variant, and
   `DriverOutcome` as discriminated unions. Store continuation and authorization
   server-side. Adapt card/player answers to `selectCards`/`selectPlayers`;
   define validated stack/mixed-target, ordering, and allocation paths explicitly.
   Card pickers must never be `custom` events.
7. **Capability gates.** Every introduced node needs validation, execution,
   serialization, and observable conformance before it is advertised as supported.
   Report legacy translations that cannot yet be represented. Keep their existing
   behavior reachable while adding the missing reusable implementation.

## Ordered implementation parts

Each part is one reviewable concern. Split a large part into smaller commits or
reviewed slices without changing its exit criteria. Paths described as new below
are proposed destinations, not existing exports.

### Part 00 — Coverage inventory and regression baseline

**Dependencies:** none.

**Status:** implementation complete; reviewed and accepted. See the reproducible
[Part 00 coverage baseline](migration/RULE-DSL-COVERAGE.md), generated migration
ledger, and versioned compatibility fixtures.

Inventory `CARD_RULES`, every `CardEffect`/`CardInstruction` variant, handler
discovery, plugin hooks, specialized dialogs, and embedded token/copy/face rules.
Create a migration ledger recording mechanic, current registrations, executable
coverage evidence, needed canonical node, compatibility route, owner part, and
status. Use the ledger to expose direct mutations and card-name dispatch that
need migration. A handler/plugin registration alone is not coverage evidence.

Run the existing rules, host, and client checks; record pre-existing failures.
Capture representative command, saved-state, and journal fixtures, including open
card/player choices and legacy mode selection. Record intended rules corrections
separately from regressions.

**Exit:** all existing paths have a migration disposition; baseline results and
compatibility fixtures are reproducible. Do not make runtime behavior depend on
the inventory being manually perfect.

### Part 01 — Canonical schema, compiler, and authoring surface

**Dependencies:** 00.

**Status:** implementation complete; reviewed and accepted. See the
[Part 01 implementation note](migration/RULE-DSL-PART-01.md).

Implement the required DSL folders, root/ability/program unions, typed domain
filters, references, amounts, decisions, and scoped cost/condition vocabulary.
Close the unions needed for the first runnable slices; introduce further variants
with their owning parts. Unsupported nodes fail with declaration-path diagnostics.

Validate JSON data as well as TypeScript-authored nodes: versions, node kinds,
domains, bounds, local target indices, modal structure, and binding availability
on every control-flow path. Reject executable values, unresolved X, duplicate
local declarations, branch-only results read outside the branch, and scope leaks.
Define expression limits, numeric validation, and evaluation-time contracts.

Implement explicit builders and defaults plus section-14 sugar:
version-pinned `card`, `ability.whenever`, `self`, `keyword`,
`actions.draw`, `and`, `choose`/`or`, `withTargets`, and `ifThen`.
Getters remain in authoring objects; saved nodes contain only immutable data.
Add pure legacy-to-canonical adapters for representable player effects and triggers.

**Exit:** explicit/compact Wall of Omens forms lower identically; canonical data
round-trips; independent runtime instances share no mutable template state.
Wrong recipient domains, unresolved bindings, and unsupported versions are rejected.
The schema can load a minimal card without claiming unsupported mechanics execute.

### Part 02 — Incarnations, captured participants, and occurrences

**Dependencies:** 01.

Extend `GameObject`, stack/context records, and creation/move/copy paths with
rules object identity. Ordinary zone changes create new incarnations; model
specified exceptions explicitly. Phasing changes status rather than incarnation.
Keep before/after snapshots, controller/owner, event amounts, and source attribution
available independently of the live source. Audit all direct `draft.move` users.

Implement domain-safe reference/selector/amount evaluation and format-owned
opponent relations. Group queries use current state at their instruction; captured
participants use their occurrence snapshots. Do not disclose hidden values merely
because the server evaluated them.

**Exit:** leave-and-return cannot rescue an old target; trigger/controller identity
survives source departure or control change; amounts and snapshots survive
serialization/replay. Typed name predicates work without name-based dispatch.

Implementation details and remaining boundaries are recorded in
[`migration/RULE-DSL-PART-02.md`](migration/RULE-DSL-PART-02.md).

### Part 03 — Durable driver and explicit execution checkpoints

**Dependencies:** 02.

Introduce driver/frame modules alongside the kernel. Start with a fully supplied,
untargeted spell using the existing life/draw handlers. Commit each instruction's
events before executing the next; preserve child frames through suspension.
Remove `AFTER_QUEUED_EVENTS` special cases only as the general cursor replaces them.

Refactor kernel event draining so ordinary SBAs and pending-trigger placement
belong to explicit checkpoints. Preserve continuous-characteristic recomputation
between instructions. Carry the intended next priority holder through checkpoints;
reset the pass sequence on actions; resolve only one top item per all-pass round.
Apply each simultaneous SBA set as one group and repeat checkpoints until stable;
report non-convergence explicitly instead of silently stopping at an iteration cap.
Retain explicit rule exceptions and immediate concession handling.

Generalize spell completion/disposal and ability independence. Mark a failed draw
for the next applicable SBA rather than eliminating its player mid-instruction.
Keep a legal resolving program alive even if its stack object later leaves.

**Exit:** draw-then-discard reads the resulting hand; temporary lethal/zero-toughness
states can be repaired by later instructions; a suspended frame does not dispose
of the spell, run SBAs, or resolve another item. Priority after action/resolution
and pass resetting are covered. A driver fixture restores its cursor from data.

### Part 04 — Whole-item target legality and resolution outcomes

**Dependencies:** 03.

Implement target clauses and runtime bindings keyed by generated scope and clause
index. Support player, object-incarnation/zone, and stack-item targets. Reuse
shared filters and targeting restrictions; add required cross-clause constraints.
Ward permits targeting and is handled by a trigger, not candidate exclusion.

Bind supplied targets before stacking. On resolution, check intervening-if and
one whole-item target gate, retaining legality by clause without compacting slots.
Distinguish `didNotResolve: allTargetsIllegal`, `countered`, and ordinary failed
actions. For illegal targets, withhold information where required; source LKI is
not permission to read an illegal target's old characteristics.

**Exit:** all/some/zero optional targets behave differently; the same recipient
can be legal for one clause and illegal for another. Source removal is independent
of target legality. No automatic retargeting occurs. Countering an uncounterable
but legal spell fails while independent later instructions can still execute.

### Part 05 — Typed requests, answer handling, projection, and adapters

**Dependencies:** 03, 04.

Add the full section-9 envelope with phase, purpose, chooser, cancellation,
request ID, revision, authorized candidates, and typed offer/answer variants.
Implement request freshness, exactly-once consumption, and immutable continuation
lookup. Invalid answers retain the pending request; duplicates cannot rerun effects.
Cancellation affects only uncommitted proposals. Specify how immediate concession
invalidates requests or frames so a departed chooser cannot strand the driver.

Keep card and player answers on existing typed events. Add validated stack/mixed
target, options, ordering, and allocation contracts; do not trust client-supplied
events or continuation payloads. Update development commands and clients to the
new offers. Add temporary adapters only when an unmigrated path needs them; old
clients are not a final compatibility requirement.

Integrate `kernelChoicePrepare*`/`kernelChoiceApply*`, host action gating,
`protocol.ts`, `shared/liveTypes.ts`, wire codecs, the browser picker, and the
headless driver. Treat `needsInput` and ordinary priority as distinct states.
Project only authorized requests, candidates, public outcomes, and waiting status.

**Exit:** wrong-seat, stale, duplicate, and invalid replies are tested through the
host; reconnect republishes the same authorized request. Browser and headless
answers produce equivalent state. Hidden hands/library choices, frame snapshots,
results, and traces remain private. Closing a mandatory dialog cannot cancel it.

### Part 06 — Pending triggers and checkpoint placement

**Dependencies:** 02, 03, 05.

Make matching consume actual occurrences and capture pending instances; do not
place non-mana triggers during nested event application. Preserve look-back
sources for departures and simultaneous deaths. Separate trigger-only conditions
from intervening-if, and preserve frequency identity across instances/turns.

At checkpoints, stabilize SBAs, perform the two CR 603.3b APNAP placement passes,
request each controller's ordering, and bind trigger modes/targets before granting
priority. Impossible mandatory placement choices remove that trigger. Reuse this
queue for delayed/reflexive abilities and ability grants as their nodes arrive.

**Exit:** Blood Artist dying with two creatures yields three independent pending
instances with captured control, including its own death. OR matching never
duplicates one occurrence. Draw-three collects triggers without intermediate
response windows. Required/optional targets and intervening-if are covered.

### Part 07 — Reusable action primitives and structured programs

**Dependencies:** 03, 04, 05; trigger integration uses 06.

Standardize life, damage, draw, mill, discard, move, destroy, sacrifice, counter,
token creation/copy, phasing, and proliferate before migrating cards needing them.
Each primitive specifies domains, amount evaluation, source attribution,
grouping, replacement entry points, typed results, and impossible-action behavior.
Keep destroy/sacrifice/damage/phasing semantics distinct from raw zone/life changes.

Implement sequence, conditions, instruction-program choices, card/player choices,
and result bindings using nested frames. Selected-card discard and player/count
discard are distinct forms. Semantic discard/counter/payment outcomes remain
correct when a component destination changes. Gather simultaneous player choices
in the required order, then commit their action group; do not approximate with a
series of fully reduced single-recipient actions.

**Exit:** non-targeted groups bypass targeting restrictions while retaining action
rules; damage attribution/prevention/lifelink/infect stay intact. Simultaneous
removal sees shared before-state; sequential instructions see earlier results.
Empty groups/hands do not create impossible pickers. `and`, `or`, and conditional
branches have different observable behavior and resume once.

### Part 08 — Announcement transactions, costs, and mana abilities

**Dependencies:** 04, 05, 06, 07.

Implement complete proposals and optional read-only `prepareAction` offers.
Close mandatory/optional/alternative cost plans, casting permissions,
increases/reductions, distributions, and shared X bindings. Reuse mana computation
and spending restrictions. Validate targets and payments in the ordered procedure,
lock the total cost, permit eligible mana abilities, and require full payment.

Use an isolated provisional transaction if announcement must suspend. Invalid or
cancelled proposals leave no committed payment/target/cast occurrences. A fully
supplied valid proposal requires no target picker; replacement choices during
payment still use its transaction frame. Successful announcement publishes costs
and waiting triggers atomically, with no response window inside payment.

Apply the same activation permission checks to normal activations, `tapForMana`,
nested payments, and mana planning. Validate CR 605 classification, including
triggered mana abilities; merely containing `addMana` does not qualify.

**Exit:** Aether Tide uses one X for targets, mana, and discard; X=0 works.
Insufficient targets/cards/mana, double-used payments, and cancelled proposals
roll back. Completed costs stay paid after countering/target failure.
Untargeted costs ignore targeting restrictions. Replacement-aware payment tests
are completed with Part 11; eligible mana abilities use no stack or priority pause.

### Part 09 — Scoped modes, distributions, copies, and retargeting

**Dependencies:** 08.

Choose modes at announcement/trigger placement; generate a scope for each selected
occurrence. Unselected modes contribute nothing. Repeatable selections preserve
independent local targets/results and execute in printed mode order. Validate
mode cardinality, distributions, local distinctness, and cross-clause constraints.

Preserve modes/X/bindings when copying spells; distinguish copying from casting.
Implement explicit legal retargeting without silently refreshing invalid bindings.
Replace legacy mode IDs/labels with scoped identities; use temporary adapters
only while unmigrated paths need them.

**Exit:** Ashling's Command creates its copy before querying the later damage
group. Brokers Confluence can repeat modes with independent or repeated recipients,
and proliferate choices happen separately during resolution. All-illegal targets
suppress every selected mode; three untargeted modes do not fail that gate.
Copies do not fire cast triggers; allowed retargeting follows its own procedure.

### Part 10 — Temporary effects, optional payments, and reflexive programs

**Dependencies:** 06, 07, 08.

Close `createEffect`, duration/deadline, optional resolution payment,
delayed/reflexive trigger, and generated/granted ability nodes. Resolution payments
reuse cost semantics but have their own payer and decision time. An `if you do`
branch reads a typed outcome; a `when you do` program creates a separate trigger.

**Exit:** declining a sacrifice creates no reflexive trigger; paying it queues one
for a later checkpoint with a new target decision. A replaced destination can
still satisfy payment. Nested casting/payment resumes its parent without ordinary
priority. Effects and delayed programs retain independent source/version context.

### Part 11 — Resumable replacement processing and lineage

**Dependencies:** 05, 07, 08, 10.

Replace the kernel's timestamp-first loop with pure applicability discovery and a
persisted event frame. Implement CR 616 precedence categories, appropriate chooser,
optional decisions, re-evaluation, and instance-used/optional-decision ledgers.
Carry these through modified descendants and suspensions; independent events
start independent replacement opportunities. Never use a card-authored skip flag.

Add typed modification, replacement program, redirection, and suppression nodes.
Replacement programs execute ordered instructions and can choose, suspend, branch,
or create additional replaceable actions. Preserve parent action outcomes,
prospective entry information, simultaneous groups, and actual occurrences.
Adapt legacy replacement hooks only where semantics are known; record gaps.

**Exit:** competing modifiers expose legal player choices; replaced draws/deaths
do not create those occurrences. Self-entry/color choices precede committed entry.
Used-instance ledgers prevent recursion without disabling other copies/modifiers.
Replacement of a cost component works inside the announcement transaction.
Reconnect during a replacement resumes the same event and program.

### Part 12 — Consumable prevention and damage integration

**Dependencies:** 11.

Implement prevention instances with remaining capacity, lifetime/deadline, source
identity, allocation for simultaneous sources, and typed additional effects.
Reuse shared damage handling with settled damage amounts and attribution.

**Exit:** a 2-point shield against 3 damage leaves 1; later damage consumes only
remaining capacity. Choosing double-then-prevent versus prevent-then-double yields
the specified different outcomes. Fully prevented damage has no damage occurrence;
unpreventable damage and prevention side effects obey their separate rules.
Life loss remains outside damage prevention.

### Part 13 — Static modifiers, layers, and action restrictions

**Dependencies:** 02, 07, 08, 10; static replacement integration uses 11.

Compile static abilities into runtime modifier instances with explicit active
zones and source incarnations. Audit/reuse continuous effects, keyword lookup,
combat restrictions, and derived characteristics; add missing layers/sublayers,
dependencies, CDA handling, logical timestamps, and exact expiration checkpoints.

Do not refresh a timestamp when recomputing an effect. Keep printed static
lifetimes distinct from effects created during resolution. Handle phasing,
ability removal/grants, control changes, and multiple sources. Centralize typed
activation restrictions for server legality, action offers, and mana planning.

**Exit:** Stony Silence rejects artifact activations, including mana shortcuts,
before costs; prior stack abilities still resolve. Departure/phasing/ability loss
and multiple copies behave correctly. Duskdale Wurm uses shared trample semantics;
Wall of Omens uses shared defender. Layer/dependency cases and independent
temporary-effect lifetimes have observable regression tests.

### Part 14 — Step draw history and Chains replacement conformance

**Dependencies:** 06, 07, 11, 13.

Add step-instance identity/history for actual draws, including extra draw steps
and draws during costs. Implement `wouldDraw` and `firstDrawInOwnDrawStep`.
Apply count-level replacements before individual draw events where required.
A proposal replaced by a non-draw does not consume the first-actual-draw exemption.

Build Chains from reusable static/replacement/discard/result/condition primitives.
Its `event.player` remains scoped to the matched draw while child actions create
their own event contexts. Follow-up draws retain the used-instance ledger.

**Exit:** test protected first draw, another player's draw step, draw-three,
empty hand/library, one/two Chains with sufficient or one-card hands, competing
replacements, replaced discard destinations, draws as costs, extra draw steps,
and reconnect during mandatory discard. No card-specific Chains executor exists.

### Part 15 — Combined conformance and persistence gate

**Dependencies:** 09, 10, 12, 13, 14.

Run the scenarios in the matrix below through authoritative driver, host adapters,
browser offers, and headless answers. Verify outcomes and timing from observable
state/events/requests, not only node snapshots or registration.

Exercise new DSL commands, journals, saved open choices, suspended frames,
copies/tokens, and restore with exact active definition revisions. Preserve the
behavioral assertions from Part 00 fixtures in new-format tests; old v0 payload
support is not required. Assert projections and public traces never include
private continuation values. Update live wire codecs and replay consumers
together, and reject unsupported old formats clearly.

**Exit:** all representative scenarios and new-format persistence fixtures pass.
Classify each observed difference as a regression or an intentional tested rules correction.
All newly advertised DSL capabilities have end-to-end evidence.

### Part 16 — Existing-card migration and consolidation

**Dependencies:** 00 ledger; migrate each family after its owning parts pass.
Final consolidation requires 15.

Migrate in mechanic families: simple keywords/player effects; ordinary spells and
triggers; targeting/activation/costs; modes/copies; hidden-zone choices; replacements
and static/granted effects; then specialized mechanics from the ledger (votes,
linked exile, alternate casting, faces/Rooms, Sagas, and other supported handlers).
This family list is a starting order, not a coverage limit.

Use temporary adapters to canonical data whenever representable during migration.
For specialized handlers, first add reusable nodes and conformance; until then
retain explicit legacy support and its recorded gap. Every stack item chooses
one pinned program representation and is executed exactly once. Shared checkpoint,
projection, and event rules apply across legacy/canonical cards in the same game;
test mixed games rather than switching global semantics by card.

After equivalent gameplay coverage and new-format persistence are proven, remove
all temporary legacy adapters and superseded resolution, custom resume, modal
fallback, host choice, old command/decoder, and old saved-state/replay paths.
Remove `src/cardPlugins/dsl/builders/legacy.ts` and its migration-only tests once
all consumers use canonical definitions. Rewrite useful behavioral assertions
against the canonical API; retire obsolete format fixtures. Update engine/host
documentation. Canonical authoring sugar may remain, but legacy API compatibility
wrappers may not.

**Exit:** every previously supported registration/mechanic has an accepted
migration result; no newly introduced judge fallback hides a gap. One authoritative
driver and canonical representation own progression. No legacy compatibility
layer, old-format decoder, or competing executor remains. The full regression
suites and new-format persistence gate pass after the old paths are removed.

## Dependencies and delivery order

`00 → 01 → 02 → 03 → 04 → 05` establishes the common foundation.
Then `06` and `07` can proceed on that foundation, integrating before `08`.
After `08`, mode work `09` and effect/payment work `10` can proceed independently.
`10 → 11 → 12` supplies replacement/prevention semantics.
`13` can develop alongside `11`, with its replacement integration waiting for
`11`; `14` needs both. `15` joins the conformance work; `16` migrates incrementally
by family and removes old paths only after that gate.

| DSL milestone | Plan parts | Delivery gate |
| --- | --- | --- |
| 1. Schema/compiler/authoring | 00–02 | Canonical data, scoped validation, identity, and equivalent sugar. |
| 2. Authoritative driver | 03, 04, 06 | Durable execution, checkpoint triggers, whole-item legality. |
| 3. Typed choices/adapters | 05, with every subsequent choice | Browser/headless parity, projection, restore, exactly-once answers. |
| 4. Casting/costs/modes/instructions | 07–10 | Complete proposals, shared X, scoped modes, reusable action outcomes. |
| 5. Replacement/prevention/static | 11–14 | Player ordering, lineage, shields, layers, history, branching programs. |
| 6. Card conformance | Tests alongside parts; combined gate 15 | All named cards and hypothetical lifecycle cases work end to end. |
| 7. Migration/consolidation | 16 | Supported coverage retained; obsolete paths removed safely. |

Use one implementation integration branch and separate reviewed part branches if
executing with [implement-reviewed](../.agents/skills/implement-reviewed/SKILL.md).
Give implementer/reviewer pairs the part goal, dependency commits, ledger entries,
and acceptance checks; integrate accepted parts in dependency order.

## Conformance matrix

| Scenario | First owning parts | Required evidence |
| --- | --- | --- |
| Untargeted token-entry life loss (A) | 01–03, 06, 07 | Current wrapper parity, group query at resolution, captured controller, no target picker. |
| Targeted entry trigger (B) | 04–06 | Untargeted creature cast; target request at trigger placement; distinct response window. |
| Partial/all/zero targets (C) | 04, 07 | Whole-item outcomes; indestructible action failure does not skip independent draw. |
| Counterspell and ward (D) | 04, 06–08 | Spell versus ability targets, legal uncounterable targets, paid/declined ward, no priority during payment. |
| Draw then discard (E) | 03, 05, 07 | Updated-hand candidates, private offer, durable parent, delayed checkpoint. |
| Reflexive sacrifice (F) | 06, 08, 10, 11 | Payment outcome, later independent trigger/targets, destination replacement. |
| Replaced draw (G) | 06, 11, 14 | Per-card processing, actual triggers only, independent replacement opportunities. |
| Competing damage modifiers (H) | 11, 12 | Player ordering and settled amounts; lineage and shield consumption. |
| Entry choice before trigger (I) | 06, 11, 13 | Prospective source, choice before entry, resulting entry characteristics. |
| Stony Silence (J) | 08, 13 | Every activation/mana path and offer respects restriction, source lifecycle. |
| Duskdale Wurm (K) | 01, 13 | Typed keyword definition and existing combat/trample behavior. |
| Aether Tide (L) | 02, 04, 07, 08, 11 | One X; atomic payment; owner-directed movement; paid costs survive later failure. |
| Hex (M) | 04, 07, 08 | Exactly six distinct targets at casting; legal remainder; simultaneous destruction. |
| Ashling's Command (N) | 07, 09 | Local target domains, copy before queried damage, printed order. |
| Brokers Confluence (O) | 07, 09 | Repeated scopes, ability targets, phasing, repeated untargeted proliferate choices. |
| Blood Artist (P) | 02, 04, 06, 07 | Simultaneous deaths/LKI, one match per death, captured control, target loss suppresses gain. |
| Chains of Mephistopheles (Q) | 11, 13, 14 | Every listed history/branch/lineage/empty-zone/reconnect case. |
| Wall of Omens (R) | 01, 03, 06, 13 | Equal compact/explicit data; defender; ordinary entry trigger independent of source. |

## Validation and completion

For each runtime part, add focused integration tests for its actual semantics,
then run the full rules-engine suite and relevant host/client checks. Use existing
fixtures and deterministic randomness. Resume from serialized state at the
decision boundaries, not just within one process. Keep representative card tests
with the owning mechanic and run the combined matrix at Part 15.

The existing repository commands are:

```bash
bun run test:rules
bun run test:live-runner
bun run test:site
bun run typecheck
bun run check:imports
bun run lint --quiet
```

`test:site` currently lists a limited set of files. Run new and existing browser
component tests explicitly when their paths change, and include new conformance
tests in the relevant scripts. Add executable rules/host regression commands to CI
before enabling the new default path; current CI covers types, imports, and lint.
Do not use a whole-deck game as the only proof of a primitive's rules semantics.

Completion requires the entire DSL milestone mapping, all representative cases,
and a closed migration ledger. Preserve supported card coverage, new-format
command/state/replay correctness, private projections, and pinned active programs.
Remove temporary legacy compatibility code by Part 16. Unsupported mechanics
remain explicit errors; during migration only, documented existing legacy routes
may remain until their canonical implementation is proven. They cannot remain in
the completed product or become silent approximations.

The highest-risk changes are checkpoint ownership, simultaneous before-state,
replacement lineage, scoped targets/modes, and restoring suspended DSL choices.
Their tests must land before replacing their current execution paths. Estimate calendar
effort only after Part 00 identifies specialized coverage and migration volume;
the dependency order and acceptance gates above are actionable without inventing
a deadline.
