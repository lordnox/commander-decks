# Legacy Dredge authoring retirement — #637

Parent: #487. Starting tree: `f0c92465`.

Removed the legacy `CardEffect` Dredge variant, its `replacements.dredge()`
builder, and the fallback that read `object.effects` in the Dredge replacement
plugin. The canonical Dredge ability and the generic replacement plugin remain;
card definitions and the draw, choice, mill, and return lifecycle are unchanged.

The behavior fixtures already use canonical catalog definitions. The shared
`card()` helper in `cardPlugins/dredge.test.ts` calls `cardTemplate(name, ...)`;
`cardTemplate` merges `cardTemplateDefaultsFor(name)` from the canonical catalog,
and game creation retains the template's `ruleDefinition`. The live host restart
fixture also creates Life from the Loam with `cardTemplate`, so it tests the
canonical ability through journal restore rather than the retired legacy effect.

| Existing assertion | Owner and preserved evidence |
| --- | --- |
| Choose Dredge instead of drawing, or decline for a real draw | `chooses dredge instead of drawing, or declines for a real draw` in `cardPlugins/dredge.test.ts`; verifies the choice, exact three-card mill, return of Life from the Loam, subsequent draw on decline, and cleared pending choice. |
| Insufficient library prevents the Dredge choice | `does not offer dredge when the library has fewer than N cards` in the same mechanic suite. |
| Offer every eligible Dredger for one replacement | `offers every eligible dredger for at most one replacement` checks the exact candidate set and the zero-or-one choice bounds. |
| Recheck eligibility between draws in a multi-card draw | `rechecks dredge options between cards in a multi-card draw` checks the remaining candidate and library after the first replacement. |
| Keep graveyard candidates private to the drawing seat | `projects graveyard options only to the drawing seat` checks the chooser's candidates and their absence from the opponent's projection. |
| Rebuild and resume an open choice after a host restart | `a host restart rebuilds an open dredge replacement choice` in `live-runner/src/kernelHost.test.ts` restores the journal, matches the pending choice, selects Life from the Loam, and verifies it reaches hand. |
| Pin the canonical card definitions and Dredge counts | `Dakmor Salvage dredges two beside tapped entry and {B}` and `Life from the Loam dredges three and returns up to three owned graveyard lands` in `cardPlugins/dsl/cardRuleCatalog.test.ts` check structural composition and parameters. |

Rules 702.52a–b define the graveyard ability and library-size limit; 614.11a and
121.2 cover replacement of individual draws in a multi-card draw. Cards in the
graveyard are public; chooser-specific pending-selection projection is the
engine contract verified by the mechanic test. The generated coverage ledger is
refreshed. Pinned inventory/progress accounting is unchanged; no allowance or
CI enforcement is added. The reusable Dredge runtime remains available for
canonical definitions.
