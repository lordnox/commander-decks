# Retire legacy tapped-entry execution

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#641](https://github.com/lordnox/commander-decks/issues/641)

Base: `da9f42c1`

This change removes the uninstalled `entersTapped` plugin and its obsolete
CardEffect API: the `tapSelf`, `tapUnlessPayLife`, and
`tapUnlessRevealSubtype` replacement branches, their builders, and the
`replacementTaps` reader. The independent `enteringObjectId` helper and
`PERMANENT_ENTERED` event identifier move unchanged to `permanentEntry.ts`;
all existing runtime consumers use that module. The legacy `chooseColor`
replacement route and its choice flow remain.

Existing tapped-entry tests continue to assert their previous outcomes through
the canonical card-template path. In `cardPlugins/entersTapped.test.ts`, the
following groups remain intact: “a land drop that Oracle taps enters tapped,”
“%s enters tapped,” “a land with no entry rule is untapped,” “Hall of Storm
Giants enters untapped as an early land and tapped later,” “Mystic Sanctuary is
untapped only behind three other Islands,” “%s checks the listed basic land
types,” “%s needs two basic lands to enter untapped,” “%s asks whether to pay
two life,” “%s asks for the three life its Oracle text prints, not two,”
“Morphic Pool checks for two opponents,” “a land put onto the battlefield
without being played still enters tapped,” “a surveil land both enters tapped
and opens its surveil,” “Temple of Deceit enters tapped and opens a typed scry
choice,” “another seat's lands are not counted for the conditional forms,” and
the five test groups under “relocated from kambalManaGraveyards.test.ts →
entersTapped.test.ts.” Their named `cardTemplate` fixtures resolve through
canonical card definitions; none installs the removed plugin.

`cardPlugins/opponentHasMore.test.ts` retains “opponentsAtMost still taps a
two-player fixture land on enter” with a minimal canonical static replacement
counting opponent players. Its one removed assertion only inspected the
serialized shape of the retired legacy builder; the other serialization
assertions remain.

The mechanic suites that formerly listed `entersTapped` alongside unrelated
legacy plugins keep their existing assertions and simply stop installing the
unneeded plugin: `becomeCopyOfTarget.test.ts`, `landfall.test.ts`,
`librarySearch.test.ts`, `millThenRecover.test.ts`,
`selfSacrificeMana.test.ts`, and `targetedResolve.test.ts`.

Canonical runtime semantics are owned by `dsl/entryReplacements.test.ts`,
including play-land, move, and cast entry, conditional replacements, pay-life,
private reveal choices, and resume behavior. `dsl/entryReplacement.integration.test.ts`
owns entry-choice ordering with triggers and JSON restore. Structural catalog
tests in `dsl/cardRuleCatalog.test.ts` cover named tapped-entry definitions,
including lands, Farseek, Lotus Field, and other catalog cards. This note maps
the retained current tests; it does not claim that each historic legacy plugin
branch had a one-to-one equivalent assertion.

These are replacement effects that modify how a permanent enters under
Comprehensive Rules 614.1c and 614.12, with choices made before entry under
614.12a. Entry-trigger ordering follows 603.6d.
