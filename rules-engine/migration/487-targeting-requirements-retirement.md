# Legacy targeting requirement retirement — #634

Parent: #487. Starting tree: `cb1abf4f`.

Removed the legacy `targetingRequirement` effect and builder, its format plugin,
and compatibility readers in canonical target validation and stack-copy target
checks. Flagbearer is still enforced from canonical printed static abilities.
Ordinary hexproof and shroud remain enforced from keywords. No card catalog
definitions or authoring allowances changed.

The retired legacy Flagbearer fixture's distinct caster-controlled case now uses
canonical static definitions in `dsl/targeting.test.ts`; the neighboring
canonical obligation test continues to cover rejection of another target and
acceptance of the opposing Flagbearer. `dsl/cardRuleCatalog.test.ts` continues
to structurally verify Standard Bearer's registration and Flagbearer rule.

| Retired assertion | Canonical owner / preserved evidence |
| --- | --- |
| An opposing Flagbearer permits choosing an eligible caster-controlled Flagbearer | `an opposing Flagbearer permits choosing an eligible caster-controlled Flagbearer` in `dsl/targeting.test.ts`, now with canonical static abilities on both permanents. |
| A Flagbearer requires selecting one if able | `a canonical Flagbearer imposes the same if-able obligation` in the same suite retains rejection of an eligible non-Flagbearer and acceptance of the opposing Flagbearer. |
| Targeting restrictions and copied-target legality | Existing shared keyword-based shroud/hexproof coverage and stack-copy targeting coverage remain in their owning suites; no legacy hexproof-while-untapped cards or fixtures existed. |

Rules 115.1 and 601.2c in the Wizards file linked from
`rules-sources/README.md` inform target choice during announcement. The generated
coverage ledger is refreshed. Pinned inventory/progress IDs and assertion owners
remain unchanged; no new strict CI enforcement is added. Remaining runtime and
executor cleanup stays in #487, with scaffolding cleanup in #464.
