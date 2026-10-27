# Final ownership reconciliation — #543

The full 750-group evidence audit and retention review are complete on this branch.
The unresolved Dig Through Time behavior tracked by #552 keeps #403 and #543 open.
The inventory remains pinned at `486f73779424dc94fdaaa2712337462994ebe2e6`;
the reconciliation starting tree is `c515c27c`.

## Reviewable slices

| Issue | Scope | Evidence status |
| --- | --- | --- |
| [#545](https://github.com/lordnox/commander-decks/issues/545) | Four Courser lifecycle groups | Full callbacks, all 11 assertions, helpers and compatibility route checked; exact destinations recorded in `403-progress.json`. |
| [#546](https://github.com/lordnox/commander-decks/issues/546) | All 129 #401 groups | PR [#555](https://github.com/lordnox/commander-decks/pull/555) has the reviewed 129-row owner record and is integrated in this branch. |
| [#547](https://github.com/lordnox/commander-decks/issues/547) | All 544 #402 groups | All 515 moved groups have per-group destination/runtime evidence; 29 retained groups have current owner, assertions, fixtures, and runtime-route evidence. |
| [#548](https://github.com/lordnox/commander-decks/issues/548) | Full 750-group reconciliation and suite/helper gates | The complete 129 / 544 / 77 ledgers and the 73-row non-Courser lifecycle audit are integrated. Current source/helper retention is documented below; no suites or helpers were removed. |

The inventory accounts for 129 / 544 / 77 IDs across #401 / #402 / #403. `validate-progress.py` requires exact per-group destination evidence for all 515 moved #402 groups and all 29 separately retained owners. #403 has relocation rows for all 77 IDs and an exact manual audit record for the 73 non-Courser groups; row coverage does not establish behavior equivalence for the separately recorded #552 exception.

The only current #403 lifecycle behavior exception is `cirdanMiscCards:176`: canonical Dig Through Time does not let the player order unchosen inspected cards onto the library top. This is tracked in [#552](https://github.com/lordnox/commander-decks/issues/552); do not describe that group as equivalent or close #403/#543 while it remains unresolved. Kuroki’s previously reported targeted free-cast issue #540 was fixed in merged #542 and its targeted announcement now succeeds.

The pinned #402 assertion `yurlok:79` is a superseded API check: it expected a raw activation event without `manaAbility` to fail with “mana ability.” The current canonical runtime offers Yurlok's action, accepts that event, and resolves it with an empty stack; the classifier infers a mana ability from its activated mana-production program. Issue search found no matching Yurlok defect, and this reproduction does not show a current stack-behavior defect. Record the changed assertion contract explicitly rather than claiming the pinned rejection assertion is preserved. This is not an unresolved behavior exception; #552 remains the sole current behavior exception.

No suite, source helper, runtime code, or inventory entry has been deleted by #548. The ten detailed suites listed below remain present with current catalog snapshots, integration assertions, and mechanic owners. The pinned helper consumer inventory in `helpers.md` remains a removal gate. Do not close #403 or #543 until #552 is resolved.

The pinned `helpers.md` has 531 helper rows across 64 historical source paths and references 628 unique ownership groups. A current path check finds 4 of those exact historical paths still present; all 628 group references are represented in the combined #401/#402/#403 ledgers. The shared `cirdanCreatureCards.ts` helper remains imported by 11 current test files, so it is retained. Historical group accounting is not a substitute for the final per-helper current import review; no helper is removed by this reconciliation.

## Checked Courser evidence

The four source callbacks are `courserOfKruphix:26`, `:42`, `:77`, and `:99`.
Their complete destination is `rules-engine/src/cardPlugins/libraryTop.test.ts`.
Each entry in `403-progress.json` now includes its exact destination title,
all pinned matcher texts, the preserved outcomes, and fixture/runtime evidence.

Comparing each complete pinned callback (inclusive `line` through `endLine`
from `inventory.json`) with that destination produces an exact text match
after these substitutions only:

- The reveal and departure titles say reveal-top source/source rather than Courser.
- `cardTemplate('Courser of Kruphix', { types: ['Enchantment', 'Creature'] })`
  becomes `revealer()`.
- `courserPlugins` becomes `plugins`; `courserId` becomes `sourceId`.

The original `card`, `forest`, and `passAll` helpers retain their implementation;
`ok` and `resolveStack` still come from `testHelpers`. Both plugin arrays install
`onResolve` and `courserOfKruphix` with random `0.5`. The latter plugin source
is byte-for-byte unchanged from the pinned tree. The pinned registration has
reveal-top, play-top-land and landfall/gain-one-life effects plus its handler;
the current generic fixture supplies the three effects and installs that same
handler through the plugin array. Neither fixture supplies a canonical definition.
Current `libraryTopKnowledge` still checks these legacy static effects,
`plugins/lands` consumes the play permission, and draw/reveal synchronization
retains the compatibility route. Canonical static support in that shared helper
does not replace these tests.

No assertions are missing from these four groups. No source, helper, runtime,
or inventory removal is justified or performed by this slice. The former
card-named suite is already absent at the starting tree.

## Remaining retention gates

The ten detailed audited suites still exist in the integrated checkout: the five
`dsl/cardRuleCatalog` suites for the main catalog, damage/leaves,
modes/copies/search, statics/alternative costs, and targeted actions;
`registry.test.ts`; and `activatedTargetZones.test.ts`, `combatTax.test.ts`,
`demonstrate.test.ts`, and `liveTableMana.test.ts`. Their existence alone is
neither an obsolete-source finding nor checked retention evidence. The current
files were inspected: catalog suites read canonical snapshots and assert
registrations, selectors, instructions, and parameters; `registry.test.ts`
checks structural registration; `activatedTargetZones.test.ts` checks the
canonical route and zone constraints; the remaining mechanic suites retain
their integration and runtime assertions. Their imports are local test/runtime
dependencies, not exported helpers consumed by other tests.
The historical helper consumer list in `helpers.md` remains a removal gate,
not permission to remove its entries automatically.

## Local validation for #545

At implementation: the four library-top tests pass with 11 expectations;
`validate.py` checks all 271 pinned suites, 750 groups and 2594 assertion sites.
Broader repository checks and hosted results are recorded in the implementation
PR. The pinned validator checks historical source accounting; `validate-progress.py`
checks current per-group evidence coverage. Neither check by itself proves
behavioral equivalence, so the manual audits and #552 exception remain part of
the reconciliation record.

## #548 local checks

The 73-group lifecycle review checked each current callback against its pinned
assertions, fixture names/parameters, runtime route, private/public projection,
and restore path where applicable. The affected focused tests passed: 188 tests
across 11 files, 1,198 expectations. A temporary exact Kuroki targeted-cast
reproduction passed after merged #542. On the integrated tree, `validate.py`
passes the pinned accounting (271 suites, 750 groups, 2,594 assertion sites),
and `validate-progress.py` passes #401 (129/129), #402 (515 relocations plus 29
retained owners), and #403 (77/77, including 73 manual-audit groups and the
#552 exception).

Local checks passed: `bun test rules-engine` (3,947 tests, 16,451 expectations),
`bun test live-runner` (255 tests, 1,627 expectations), site tests (53 tests, 145
expectations), both TypeScript checks, DSL authoring tests (12 tests, 58
expectations), the DSL authoring gate, rule DSL coverage, import validation,
lint, and production site build. The linter reports repository warnings but
exits successfully. Hosted CI and PR-title checks are pending on the final PR
head; they will be checked before reporting completion.
