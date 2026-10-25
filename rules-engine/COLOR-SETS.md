# Normalized color sets

Tracking: [#391](https://github.com/lordnox/commander-decks/issues/391).
The shared primitives are [#489](https://github.com/lordnox/commander-decks/issues/489);
runtime adoption is [#490](https://github.com/lordnox/commander-decks/issues/490).
This audit describes the source at `94bb37cd`, before runtime adoption.

`shared/cardColors.ts` defines the five individual `CardColor` values and all
32 complete `ColorSet` values. A set uses WUBRG order, with `''` for colorless.
Use `normalizeColorSet` only for external arrays, including Scryfall `colors`
and `color_indicator` arrays. Use `parseColorSet` for canonical strings: it
rejects duplicates, reordered letters, unknown symbols, arrays, and `C`.
Contains-color queries use `colorSetContains`; exact equality uses `===`.

The DSL schema reuses the shared single-color constant and type. Complete
color values in runtime objects and DSL v1 definitions **still use arrays**.
The foundation does not change serialized programs, revisions, or gameplay.

## Adoption boundaries

| Owner / source | Current representation | Required adoption work |
| --- | --- | --- |
| `src/types.ts`, `src/definitions.ts`, `src/newGame.ts` | Arrays in `GameObject`, `FaceCharacteristics`, `CopySnapshot`, color-change before/after values, event payloads; default `[]` | Change complete sets together; default to `''`. Preserve optional-field presence and distinguish absent from colorless. |
| `src/cardPlugins/dsl/schema/v1.ts`, `compiler/validate.ts`, `src/cards/` | Array-valued token colors, copy modifiers, template defaults and `setColors`; individual `CardColor` predicates and choices | Change only complete-set fields. Keep single-color predicates/choices and sets of allowed choices distinct. Validate canonical strings strictly and update every catalog producer. |
| `src/cardPlugins/dsl/compiler/runtime.ts`, `src/cardPlugins/selectors.ts` | Membership/length filters; legacy selector `colors` means all listed colors are required | Preserve contains, all-required-colors, exact, colorless, mono and multi distinctions. Revalidate targets against current characteristics at resolution. |
| `src/kernel.ts`, `src/driver.ts`, `src/cardPlugins/colorEffects.ts` | Color-changing events, reversible arrays, token construction, copiable colors and layer-5 reapplication | Replace array copying/deduplication with immutable canonical values. Preserve copy-before-color-change ordering and expiration. Keep existing copy/color mechanic assertions. |
| `src/replay.ts`, `src/testHelpers.ts` | Infer colors from mana symbols; replay faces expose mana/Oracle fields | Thread authoritative external color/indicator data through replay/catalog input. Honor devoid and indicators; mana-cost inference alone is insufficient. Normalize once at external input, not during restore. |
| `src/deckCardFixtures.ts`, `.agents/skills/simulate-table/scripts/deal-table.ts`, `fetch-deck-tokens.ts` | Deck/replay and Scryfall token producers; token cache currently stores Scryfall arrays | Distinguish cache/source data from runtime values. Keep cached Scryfall records and manifests in their external format; normalize when constructing runtime data. Audit faces separately. |
| `src/cardPlugins/dsl/compiler/index.ts`, `compiler/data.ts`, `src/cards/snapshot.ts` | Versioned definitions, revision checks, bundled/pinned snapshots | Bump the DSL schema for changed complete-set shapes; compile/hash new definitions consistently. Suspended programs must retain their pinned new-format definition, including copy/token/color effects. |
| `src/journal.ts`, `src/runtime.ts`, `src/replay.ts`, `live-runner/src/kernelOpen.ts` | Kernel journal `rules-engine/v0`, restore, authoritative state, projected replicas and replay import | Version and validate persisted envelopes and nested color fields before execution. Exercise save/reopen, replay import, client sync and private projection with new values. |
| `shared/liveTypes.ts`, `site/src/liveCodec.ts`, `site/src/liveCompact.ts`, `site/src/scryfallCache.ts` | Host/browser transport, external card details, seat display colors | Trace exposed object/face payloads through consumers. Seat CSS colors are unrelated and stay strings. External Scryfall data stays an input format. Keep privacy/redaction tests. |
| `src/cardPlugins/effectDefinitions.ts`, `effectRuntime.ts` | Legacy token/effect arrays and predicates | Coordinate with #473 removal. Do not add new compatibility executors or extend legacy card authoring to accomplish adoption. |

Paths in the table are relative to `rules-engine/` unless they begin with
`shared/`, `site/`, `live-runner/`, or `.agents/`.

## Persistence policy for adoption

Adopt strings in one coherent runtime/schema change after the primitives land.
Bump affected DSL and journal/envelope versions and reject old array-valued
saved programs, snapshots and journals with an actionable unsupported-format
error directing callers to recreate the game. Validate versions at the actual
restore/import boundaries; a version constant alone is insufficient. Do not
silently normalize persisted arrays, reinterpret pinned old revisions, or keep
an indefinite dual-format decoder. Existing external Scryfall arrays remain
supported through the explicit input normalizer.

`ManaId` and mana pools retain `C`; it must never enter a `ColorSet`.
Commander color identity is a separate characteristic: normalize it only at
its own explicit boundary, and never substitute it for current object colors.
Likewise, available/chosen mana colors are individual options, not an object's
complete color set. Preserve those distinctions even where field names match.

## Validation ownership

`src/cardColors.test.ts` exhaustively checks the primitive domain and input
boundaries. Adoption must extend existing generic color, copy, targeting,
compiler validation and persistence suites for devoid, color indicators,
changing colors, target revalidation, layer ordering and suspended restore.
Use catalog definitions for integration fixtures; keep catalog tests structural.
Run full engine, host and browser tests plus typecheck, imports, lint and DSL
authoring checks. This foundation does not establish those gameplay behaviors.
