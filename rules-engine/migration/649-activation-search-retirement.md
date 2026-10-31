# Retire legacy activation and search adapters

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#649](https://github.com/lordnox/commander-decks/issues/649)

Base: `b9ee8790`

This note tracks the finite source, registration, and test ownership inventory
for #649. The first checkpoint removes the standalone legacy planeswalker
loyalty adapter. Canonical activated abilities, loyalty costs, sorcery timing,
targets, and resolution remain in the Rule DSL.

## First checkpoint: planeswalker adapter

| Legacy route / fixture | Owner after removal | Disposition |
| --- | --- | --- |
| `cardPlugins/planeswalker.ts`: loyalty timing, target and stack adapter | `cardPlugins/dsl/loyalty.test.ts`; `dsl/targeting.test.ts`; canonical runtime | Removed; `planeswalker.test.ts` remains as the catalog-backed integration owner with no adapter registration |
| Jace optional-payment choice visibility in `planeswalker.test.ts` | `driver.test.ts`, `all-pass canonical resolution suspends at a replacement choice without running SBAs` | Retained in its integration suite; driver test is the canonical private-choice owner |
| Ugin +2 loyalty payment and player-target damage | `dsl/loyalty.test.ts`, `plus loyalty pays counters immediately and resolves its program from the stack` | Retained in `planeswalker.test.ts`; canonical mechanic suite owns activation and stack lifecycle |
| Ugin +2 battlefield target | `dsl/loyalty.test.ts` plus canonical any-target validation in `dsl/targeting.test.ts` | Retained in `planeswalker.test.ts`; the live host Teferi fixture also retains object targets end to end |
| Ugin −X colored permanent and mana-value filter | `dsl/loyalty.test.ts`, `minus X loyalty exiles colored permanents at the chosen mana value or less` | Retained in `planeswalker.test.ts`; exact canonical mechanic coverage |
| Ugin −10 gain/draw/choose/place sequence | Canonical `dsl/amount.test.ts`, `dsl/draw.test.ts`, `dsl/chooseCards.test.ts`, and `dsl/move.test.ts` | Retained in `planeswalker.test.ts`; canonical instruction suites own the component mechanics |
| Loyalty overpayment, once-per-turn, sorcery timing, action offer, payable X choices | `dsl/loyalty.test.ts`, `a walker activates a loyalty ability once per turn and cannot overpay`, `loyalty abilities are sorcery-speed and are offered as legal acts`, and `minus X loyalty is offered for each payable X` | Retained in `planeswalker.test.ts`; exact canonical mechanic coverage |
| Teferi +1 typed artifact/creature/land targets, target rejection, resolution and priority in host action | `live-runner/src/kernelHost.test.ts`, `activates Teferi +1 with submitted targets and opens priority` now uses the catalog Teferi definition | Retained as canonical end-to-end host coverage |
| Teferi −2 private top-three selection and −7 emblem/step behavior | `dsl/inspectTop.test.ts`, `dsl/orderCards.test.ts`, `dsl/emblems.test.ts`, and `dsl/stepTriggers.test.ts` | Retained in `planeswalker.test.ts`; existing instruction and trigger mechanic owners |

## Remaining finite source inventory

| Source | Legacy surface still to retire | Status |
| --- | --- | --- |
| `cardPlugins/activated.ts` | `CardEffect op: 'activate'` announcement, cost, target, resolution and legacy mana reader; keep canonical activation and mana paths | Pending |
| `cardPlugins/abilities.ts` | `activate`, `ability`, cycling, encore, embalm, escape, monstrosity, crew and other legacy builders used by fixtures | Pending; removed only dead `cycleHand`/`typecycleHand` search producers with the obsolete instruction route; remaining builders stay in scope |
| `instructions.ts`, `effectDefinitions.ts`, `instructionHandlers/control.ts` | Legacy `CardInstruction kind:'searchLibrary'`, its `SearchSpec` type, and runtime handler | Removed in this checkpoint; `cycleHand`/`typecycleHand` were the only producer; canonical DSL cycling/search builders remain |
| `cardPlugins/librarySearch.ts` | Legacy pending-search protocol and search-specific ability; retired action request validation | Removed in this checkpoint; only the explicit `librarySearch.fetch` rejection remains until general activation admission replaces it |
| `actions.ts` | Legacy activation/search action enumeration and `librarySearch.fetch` action wiring | Partial: removed search-specific action enumeration, cost/target group lookup, and spell sacrifice adapter; legacy activation wiring remains pending |
| `rules/actions.ts` | Legacy effect lookup for ability resolution; generic ability and canonical resolution remain | Pending |
| Test-only fixture owners | `activationCostReduction.test.ts`, `activatedTargetRecheck.test.ts`, `runInstructions.test.ts`, `simpleEffects.test.ts`, `playerEffects.test.ts`, `manaChoice.test.ts`, `selfSacrificeMana.test.ts`, `demonstrate.test.ts`, `discardCostBlinkSelf.test.ts`, `plugins/energy.test.ts`, `plugins/tokenCeases.test.ts`, and legacy activation users in `landfall.test.ts`, `exilePayoffs.test.ts`, `millThenRecover.test.ts`, `modalSpell.test.ts`, `targetedResolve.test.ts`, `delayInstructions.test.ts`, `triggerFrequency.test.ts`, `sacrificeTriggers.test.ts`, `wardLife.test.ts`, and `selfSacrificeMana.test.ts` | Partial: obsolete CardInstruction search and plugin registrations are removed; the remaining activation fixture owners are pending |
| Generated-object prerequisite shared with #651 | `createToken`'s legacy `template.effects` forwarding/default plus `plugins/tokenCeases.test.ts`'s two legacy activation fixtures | Removed in the #651 checkpoint: creation strips legacy effects while preserving canonical `ruleDefinition`; both tokenCeases activations now use canonical programs |

The canonical `dsl/activationCostReduction.test.ts`, `dsl/announcement.test.ts`,
`dsl/plannedPayment.test.ts`, `dsl/targeting.test.ts`, `dsl/keywordModifiers.test.ts`,
and `dsl/searchLibrary.test.ts` already own reusable activation cost, timing,
target legality/recheck, private search selection, and restore behavior. Future
checkpoints will cite exact tests or migrate unique mechanics into these suites.
No card registration or DSL-authoring baseline allowance is changed here.

## Search effect adapter checkpoint

| Legacy route / fixture | Canonical owner | Disposition |
| --- | --- | --- |
| Search ability/spell effect builders, `op: 'search'` lookup, `librarySearch.fetch` action offer and target-cost wiring | `dsl/searchLibrary.test.ts` activated search, `dsl/announcement.test.ts`, `dsl/targeting.test.ts` | Removed. The canonical search suites retain activation costs and announcement before opening a typed search selection. |
| Spell-level search sacrifice count adapter | `dsl/searchLibrary.test.ts` catalog sacrifice-count search and zero-sacrifice search | Removed from spell parsing; canonical DSL additional-cost receipts retain count, validation, cost timing, and restore coverage. |
| Catalog Expedition Map and Archaeomancer's Map search integration | `librarySearch.test.ts`, `dsl/searchLibrary.test.ts` | Retained through the catalog definitions. Tests still exercise action announcement, private library selection, find limits, and hidden identity projection. |
| Delayed return after a search selection | Canonical minimal activated program in `librarySearch.test.ts`; reusable restore owners in `dsl/searchLibrary.test.ts` and `dsl/delayedPrograms.test.ts` | Migrated from `searchAbility`/`SearchSpec.after` to an activated DSL program with `searchLibrary` followed by `createDelayed`; the test restores while the private pick is pending and again before cleanup. |
| `SEARCH_BEGIN`/`SEARCH_CHOSEN`, pending-search state, kernel admission and live-host `library-search` stage | `librarySearch.ts`, `kernel.ts`, `kernelChoice*.ts`, `lobby.ts`, `pendingDialog.ts` | Removed after caller trace: the old `CardInstruction searchLibrary` was their only producer. DSL `searchLibrary` lowers to typed `chooseCards(viewLibrary)` followed by reveal/move/shuffle and resumes via the shared typed-selection protocol. |
| Search privacy, stale prompt rebuild, restart, fail-to-find, invalid picks, and cost-before-search behavior | `dsl/searchLibrary.test.ts`; `kernelHost.test.ts` tests `the searching seat is the only viewer who sees the candidates`, `a saved dialog that no longer matches the kernel is rebuilt`, `a restarted host rebuilds the open search instead of resolving past it`, `a search with nothing to find fails to find and resolves the spell`, and `a choice outside the search requirements is rejected` | Retained on the canonical typed select-card path. There was no existing multiple-pending-search assertion; the old pending marker supported an unused queue. |
| Old Scapeshift `sacrifice-lands` dialog stranded-choice test | `librarySearch.test.ts`; canonical typed additional-cost receipt, stale prompt, and selection-rejection owners above | Removed with the unproduced dialog kind. The old test seeded a synthetic legacy dialog directly; it did not exercise a canonical search or a live producer. |
| Saved-state decoding for the removed search markers | Journal/runtime source scan | No dedicated state-format decoder consumes `SEARCH_PENDING`, `SearchSpec`, or the old begin/chosen callbacks; canonical restart coverage serializes typed selection continuations. No separate #654 handoff was needed for this route. |
| Retired `librarySearch.fetch` event admission | `librarySearch.test.ts` dispatches the retired ID against a plain Forest | Kept a narrow `librarySearch` legal guard returning the prior rejection until the general legacy activation adapter is removed; no search action, ability, cost, or target wiring is restored. |
