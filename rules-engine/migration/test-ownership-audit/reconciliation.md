# Final ownership reconciliation — #543

This is a progress record, not a declaration that the full audit is complete.
The inventory remains pinned at `486f73779424dc94fdaaa2712337462994ebe2e6`;
the reconciliation starting tree is `c515c27c`.

## Reviewable slices

| Issue | Scope | Evidence status |
| --- | --- | --- |
| [#545](https://github.com/lordnox/commander-decks/issues/545) | Four Courser lifecycle groups | Full callbacks, all 11 assertions, helpers and compatibility route checked; exact destinations recorded in `403-progress.json`. |
| [#546](https://github.com/lordnox/commander-decks/issues/546) | All 129 #401 groups | Structural reconciliation remains open; 128 groups have no relocation entry at the starting tree. |
| [#547](https://github.com/lordnox/commander-decks/issues/547) | All 544 #402 groups | Core reconciliation remains open; 289 groups have no relocation entry at the starting tree, including the 29 `keep-owned` rows. |
| [#548](https://github.com/lordnox/commander-decks/issues/548) | Full 750-group reconciliation and suite/helper gates | Depends on the three evidence slices; also verifies the remaining 73 #403 groups against their evidence. |

The starting implemented lists contain 129 / 515 / 77 IDs respectively.
These counts do not establish equivalence. After #545, all 77 #403 IDs have
relocation entries, but the other 73 still need the final evidence review.
Missing relocation entries do not by themselves establish missing tests.
Do not close #403 or #543 based on this partial reconciliation.

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

Ten detailed audited suites still exist at the starting tree: the five
`dsl/cardRuleCatalog` suites for the main catalog, damage/leaves,
modes/copies/search, statics/alternative costs, and targeted actions;
`registry.test.ts`; and `activatedTargetZones.test.ts`, `combatTax.test.ts`,
`demonstrate.test.ts`, and `liveTableMana.test.ts`. Their existence alone is
neither an obsolete-source finding nor checked retention evidence. #546/#547
must identify each surviving group's owner; #548 must inspect current contents
and helper imports before documenting final retention or deleting anything.
The historical helper consumer list in `helpers.md` remains a removal gate,
not permission to remove its entries automatically.

## Local validation for #545

At implementation: the four library-top tests pass with 11 expectations;
`validate.py` checks all 271 pinned suites, 750 groups and 2594 assertion sites.
Broader repository checks and hosted results are recorded in the implementation
PR. The pinned validator validates historical source accounting, not behavioral
equivalence of migrated tests. Hosted validation does not finish the outstanding
manual evidence audits above.
