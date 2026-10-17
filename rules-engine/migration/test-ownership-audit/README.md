# Legacy test ownership audit — #400

Audited `origin/main` **`486f73779424dc94fdaaa2712337462994ebe2e6`**, 2026-10-15. Parent: [#389](https://github.com/lordnox/commander-decks/issues/389); implementation: [#401](https://github.com/lordnox/commander-decks/issues/401), [#402](https://github.com/lordnox/commander-decks/issues/402), [#403](https://github.com/lordnox/commander-decks/issues/403). This is a static, source-backed ownership inventory. It changes no tests, fixtures, runtime behavior, registry, or migration allowance.

## Scope and results

[scope.md](scope.md) lists **271 rules-engine suites / 2089 test callback declarations**. The detailed inventory covers **74 suites**, every deck/card-grouped dump plus mixed mechanic suites that also have structural #401 rows, with **2594 distinct literal assertion sites**. The other 197 suites already have kernel, mechanic, compiler, or protocol ownership and are retained without a per-assertion inventory. Counts are source declarations, not expanded Bun test counts: loops and `test.each` parameterizations remain attached to their group.

There are **750 ownership groups** after splitting mixed configuration/gameplay tests and accounting for assertion-bearing helpers. The initial 28 filename candidates were not complete: Kambal, individual-card suites, deck-oriented groups hidden under mechanic filenames, named canonical integrations, and gameplay inside catalog suites also need ownership decisions.

| Disposition | Groups | Meaning |
| --- | ---: | --- |
| `keep-owned` | 29 | Already has a reusable mechanic owner; retain that coverage. No move or deletion is required merely because this inventory includes it. |
| `structural` | 126 | Retain or consolidate registration, Oracle, selector, cost, instruction, and template/snapshot contract checks in #401. |
| `move-preserve` | 592 | Preserve the full assertion group in its destination before removing its source. Equivalent coverage has **not** been established. |
| `duplicate` | 3 | Source assertions are covered by the cited same-path tests. #401 may remove the source behavior only after preserving its card composition structurally. |

## Read the inventory

| Section | Suites | Groups |
| --- | ---: | ---: |
| [cirdan](cirdan.md) | 7 | 205 |
| [dack](dack.md) | 7 | 91 |
| [sin](sin.md) | 7 | 44 |
| [homer-eva-kambal](homer-eva-kambal.md) | 8 | 73 |
| [single-card](single-card.md) | 18 | 92 |
| [mixed-card](mixed-card.md) | 5 | 62 |
| [canonical-card](canonical-card.md) | 11 | 53 |
| [mixed-catalog](mixed-catalog.md) | 6 | 76 |
| [existing-owner](existing-owner.md) | 5 | 54 |

Each row links the exact source revision and a destination. Test title and enclosing groups describe the scenario; the bounded assertion preview is navigation only. **[inventory.json](inventory.json) is the complete assertion record**, including full matcher text and source spans, parameterization headers, directly referenced local helpers, inherited helper assertions, imported runtime modules, fixture registration revisions/handler IDs, observed event types, disposition, implementation issue, and uncertainty flags. A mixed source test can have a separate `:composition` row for #401 and a behavior row for #402/#403. Shared helpers have their own rows and consumer lists; helper assertions can also appear with their callers, so group assertion counts are intentionally not additive.

Mixed dump suites are owned by mechanic, not by source filename. Do not destine gameplay into another suite this audit empties. Restart/reconnect titles belong to #403. Pure existing mechanic owners stay in [scope.md](scope.md) as retained files; only mixed existing-owner suites remain in [existing-owner.md](existing-owner.md). Pinned source remains `486f73779424dc94fdaaa2712337462994ebe2e6`.

Source spans and file SHA-256 hashes refer to the audited commit, not to later edits. Use the pinned source links when a line moves. Validate the inventory with:

```bash
python3 rules-engine/migration/test-ownership-audit/validate.py
```

The validator checks the complete suite census, pinned hashes, declaration accounting, distinct assertion-site accounting, exact matcher text, destination existence, issue assignments, duplicate references, circular destinations into dump suites, restart titles assigned to #403, and that every remaining group id appears in its section markdown. It does not decide behavioral equivalence or replace the audit.

## Runtime ownership is part of the evidence

[`newGame.ts:112`](https://github.com/lordnox/commander-decks/blob/486f73779424dc94fdaaa2712337462994ebe2e6/rules-engine/src/newGame.ts#L112) selects an explicit template definition first, then a canonical catalog snapshot; absent that, it uses template effects or `CARD_RULES`. Registered names are classified from the actual catalog and legacy registry at the audited revision. Inline canonical definitions and inline legacy effects are recorded separately, alongside the modules installed by the fixture.

The fixture-registration list is context, **not a claim that every listed card is the cause of every assertion**: setup can include opponents' cards, and explicit fixture definitions can override name defaults. Follow the exact assertion and its setup/helper source for the executing route. All such mixed cases remain `move-preserve`, not duplicate, unless a separate explicit equivalence note proves the relevant behavior. Core kernel behavior (combat keywords, SBAs, moves, priority) may be exercised by both canonical and legacy fixtures and retains that distinction.

A canonical mechanic test is not evidence that an unmigrated legacy executor is covered. Named legacy cases move to generic **legacy** mechanic tests until #383 migrates that runtime. This audit does not authorize new legacy configurations, allowances, or gameplay semantics: use existing generic fixture builders or preserve a catalog-backed integration until canonical support exists. Do not copy catalog definitions into new integration fixtures. If a destination cannot express the source scenario under that constraint, retain the source and record the blocker in its implementation issue.

## Implementation handoff

- **#401:** consolidate `structural` groups, preserving exact parameters; remove only the three proven behavior duplicates below. Existing structural owners may simply retain their groups. For mixed tests, move only their `:composition` assertion subset. Completed rows are listed in [401-progress.json](401-progress.json); the pinned inventory snapshot is unchanged.
- **#402:** move `move-preserve` core groups to their indicated mechanic owner; retain `keep-owned` rows as existing evidence. When the destination already exists, the requirement is to add the source group's missing assertions there, not to assume its name proves equivalence. Completed rows are listed in [402-progress.json](402-progress.json); the pinned inventory snapshot is unchanged.
- **#403:** move privacy, typed choice, rejection, host transport, continuation, journal/JSON restore, and reconnect groups. Core assertions inside these integration groups remain part of the group unless explicitly split with an owner. Reconcile [helper gates](helpers.md) and the full inventory before removing obsolete suites. Completed rows are listed in [403-progress.json](403-progress.json); the pinned inventory snapshot is unchanged.

Every group carries a primary issue. `keep-owned` assignments identify which slice should verify retained evidence; they do not create hundreds of unnecessary rewrites. Stateful integration groups may have several mechanisms but one primary lifecycle owner; preserve source/controller identity, zone/incarnation changes, legal/illegal branches, timing, and final cleanup from the complete matcher list.

Two proposed owners need creating: `plugins/enchantmentAnimation.test.ts` for Starfield's type/stat animation and Room interaction, and `cardPlugins/libraryTop.test.ts` for public library-top visibility, refresh, and play permission. Preserve their current runtime routes; do not introduce new semantics in the ownership move. Other destinations already exist; many need additional coverage rather than a new suite.

## Confirmed duplicates

| Source group | Same-path evidence | What remains |
| --- | --- | --- |
| `ladyEvangelaRemaining:76` | [`dsl/counter.test.ts:17`](https://github.com/lordnox/commander-decks/blob/486f73779424dc94fdaaa2712337462994ebe2e6/rules-engine/src/cardPlugins/dsl/counter.test.ts#L17) uses catalog Counterspell, verifies the victim reaches the graveyard, and adds target rejection, restore, empty-stack, and second-resolution checks. The source's installed legacy plugins do not replace Counterspell's canonical snapshot. | Keep Counterspell's target/composition checks in the catalog. |
| `plugDackPart33Blink:145` | [`blink.test.ts:185`](https://github.com/lordnox/commander-decks/blob/486f73779424dc94fdaaa2712337462994ebe2e6/rules-engine/src/cardPlugins/blink.test.ts#L185) exercises the same legacy delayed-blink instruction and verifies exile, next-end-step return, and one +1/+1 counter. | Keep Long Road Home's exact registration parameters structurally. |
| `plugDackPart33Blink:162` | The same [`blink.test.ts:185`](https://github.com/lordnox/commander-decks/blob/486f73779424dc94fdaaa2712337462994ebe2e6/rules-engine/src/cardPlugins/blink.test.ts#L185) covers Otherworldly Journey's identical delayed-blink/one-counter behavior. | Keep Otherworldly Journey's exact registration parameters structurally. |

## Overlap that is not deletion permission

- `cirdanColossi:205` overlaps [`shuffleIntoLibraryInstead.test.ts:188`](https://github.com/lordnox/commander-decks/blob/486f73779424dc94fdaaa2712337462994ebe2e6/rules-engine/src/cardPlugins/shuffleIntoLibraryInstead.test.ts#L188), but the source explicitly checks a third viewer (`p3`) and uses the sacrifice route. Preserve those checks in the mechanic owner before deletion.
- `cirdanColossi:107` has **no direct expect**, but calls `expectInLibrary`, whose five checks include owner zone order, graveyard exclusion, reveal logging, and shuffle logging. The generic sacrifice case at [`shuffleIntoLibraryInstead.test.ts:92`](https://github.com/lordnox/commander-decks/blob/486f73779424dc94fdaaa2712337462994ebe2e6/rules-engine/src/cardPlugins/shuffleIntoLibraryInstead.test.ts#L92) proves a destination change, not every one of those assertions. The helper and caller rows keep the complete checks.
- Guardian Project cases overlap `watchedEnters.test.ts`, but source combinations involving shuffled Colossi, stolen creatures, and token rewards remain distinct composed scenarios until accounted for. A test title or common card name is insufficient duplicate evidence.
- Canonical card-named suites sometimes supply a copied `ruleDefinition` rather than the catalog card. Retain their binding/timing/target/persistence edge cases under mechanic ownership; use the catalog for any retained card integration.
- Gameplay inside `cardRuleCatalog.*.test.ts` must move even though its filename says catalog. Initial template stamping and explicit override contracts are different from casting/resolving individual named cards; preserve those factory contracts.

## Uncertainties and characterization assertions

The inventory flags GAP/checklist assertions separately from rule conformance. In particular, `cirdanMiscCards:729` deliberately characterizes missing ward enforcement on a Saga target; `dackFaydenPart34LinkedExile:99` deliberately includes a token in Lumbering Battlement candidates. Related capability work is tracked by #383/#394. These are assertions about current behavior, not instructions to preserve incorrect rules forever. Their owning slice must check current support and matching issues before changing expectations; this audit makes no runtime defect fix or new conformance claim.

`ladyEvangelaRemaining:459` contains `hand.length + (stack.length > 0 ? 0 : 0) >= 0`, which cannot demonstrate that Breena drew a card. Its +1/+1-counter assertions remain meaningful and must be preserved. #402 should resolve the missing draw evidence; do not count that lower-bound assertion as draw coverage. An issue search for Breena found #383, not a separate confirmed draw defect. Likewise, absence of a literal `expect` does not establish dead coverage: preserve `ok`, explicit throws, and inherited helper checks.

Everything without proved equivalent evidence remains live coverage. There is no requirement to invent a duplicate label to finish the inventory; uncertain cases have conservative retain/move dispositions and an owner responsible for resolving them before deletion.

## Validation

The inventory validator passes: 271 suites, 750 groups, and 2,594 distinct assertion sites. Local rules tests pass (2,592), live-runner CI tests pass (232), site tests pass (53), and TypeScript, imports, lint, DSL authoring, and authoring tests pass.

`bun run check:rule-dsl-coverage` fails with “rule-dsl coverage ledger is stale” at `ruleDslCoverage.ts:649`. The identical command fails in a clean `git archive` export of the audited commit using Bun 1.3.14 and the same installed dependencies. Historical issue [#369](https://github.com/lordnox/commander-decks/issues/369) is closed; this is a recurrence on the pinned base, not an audit-file change. This PR leaves the unrelated ledger untouched.
