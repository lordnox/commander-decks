# Legacy castCost retirement — #623

Parent: #487. Starting tree: `c0d29315`; follows #621/#622.

Removed the legacy `castCost` effect variant, its `payLifeX`, `convoke`, `delve`,
`reduceGenericIf` and `xMana` builders, `CastCostCondition`, and the `castCosts`
plugin. Actions/spells no longer read the legacy life-X, timing, reduction,
colored-X or payment flags. The obsolete target-dependent option on the fallback
`spellCost` helper is removed from callers. Canonical cost previews, target-aware
reductions, life costs, timing, convoke/delve and shared generic-mana utilities
remain. Canonical card definitions are unchanged.

Four suites merely installed `castCosts` alongside canonical cards; those unused
plugin imports/entries are removed without changing their assertions.

## Retired delve suite assertions

The current owner is `dsl/delve.test.ts`, using its existing minimal fixture.

| Removed `cardPlugins/delve.test.ts` test | Canonical ownership |
| --- | --- |
| exiled graveyard cards pay generic mana only and leave on cast | Existing `exile chosen graveyard cards pays generic mana and leaves colored requirements`: exile on cast, paid blue, one unspent graveyard card and stack identity. Added final spell-to-graveyard and exact draw assertions to that owner. |
| delving fewer cards leaves the rest of the generic cost to mana | `partial delve pays the remaining generic amount from mana`: two exiles plus two generic/one blue, exact remaining graveyard, insufficient remainder rejected. |
| delve cannot pay the colored part of the cost | Existing `delve cannot pay colored mana or exile illegal cards` and `the unreduced delve cap rejects seven cards even with spare generic and sufficient blue mana`. |
| rejects illegal delve picks | Existing duplicate/non-delve rejection plus `delve rejects foreign, hand, battlefield and missing cards`. |
| cannot delve more cards than the generic cost | Existing unreduced-cap and post-reduction-cap tests. |
| a free cast has no generic cost to delve | `a free cast has no generic amount available for delve`. |
| legal acts offer a graveyard picker sized to what mana cannot cover | `action offers size the delve picker to the mana shortfall and submit picked cards`: exact min/max, one chosen card passed on cast, exile and stack, empty insufficient selection rejected. |
| no cast is offered when even a full delve cannot pay | Same action-offer test checks no offered action without the required blue. |
| a spell without delve gets no picker | Same action-offer test checks the normal spell is offered with no target groups. Canonical actions may serialize an empty group array; property absence was a legacy representation assertion. |

## Other legacy fixtures

- `dsl/plannedPayment.test.ts`, `a planned mana sacrifice cannot change the spell total locked before payment`, now uses a canonical conditional reduction. The minimal condition is presence of the controlled creature rather than its legacy power predicate; the fixture has one 2/2 creature in both versions. Sacrificing it for two mana removes the reduction condition, but payment remains locked at one; one mana remains, the creature is in the graveyard and the spell is stacked. All prior assertions remain.
- `live-runner/src/kernelHost.test.ts`, `a delve cast exiles the picked graveyard cards and taps lands for the rest`, now defines its cost/target/destroy program in the DSL. It supplies delve picks plus the target through canonical grouped selection instead of the old mixed scalar/array form. Rejection of insufficient picks, two mana events then cast, exact exiled cards, remaining graveyard card and stacked target assertions remain.
- Removed only `a delve spell keeps its private top-seven choice after a host restart` from `lookTopPick.test.ts`. The existing `dsl/searchLibrary.test.ts` integration `catalog Dig Through Time rejects invalid picks and restores its private pick and bottom order exactly` already covers insufficient delve/no stack, six exiles and remaining seventh card, two-Island payment event order, private top-seven candidates, invalid counts/seat/card identities, restore, two chosen hand cards, chosen bottom ordering, spell cleanup and empty stack. The old lobby look-top projection is a retired API shape; canonical typed choose/order selections supersede it. Other active legacy look-top tests remain.

The #403 evidence note is updated to avoid claiming the removed hybrid callback
still exists. Its canonical destination/title and every implemented ID remain
unchanged. The pinned inventory is unchanged. The generated ledger is refreshed;
no authoring allowance is added.

Existing canonical announcement tests retain life-X/colored-X payment and generic
reductions; `dsl/castWhen.test.ts` owns the end-step restriction; the canonical
convoke mechanic suite owns creature payment. These are reused rather than
copying them into a new migration suite. Cost announcement/payment and continued
resolution follow the official rules linked in `rules-sources/README.md`.
