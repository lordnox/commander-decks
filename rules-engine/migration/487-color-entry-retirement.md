# Retire legacy as-enter color choices

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#643](https://github.com/lordnox/commander-decks/issues/643)

Base: `d6e5d06e`

This slice removes the card-authored legacy `chooseColorOnEnter` effect, its
`chosenColor` runtime plugin, and the `CardEffect` replacement variant. The
`enchantedManaBoost` static effect now accepts only a fixed mana color; its
runtime plugin and Wild Growth behavior remain. Shared `GameObject.chosenColor`
storage remains because the canonical Rule DSL writes and consumes that value.

The legacy `choose-color` pending-action tag and its option-selection dispatch
branch are retired with their sole producer. Canonical as-this-enters choices
use `replacementProgramChoice` and the existing pending selection envelope.
The migrated Aura tests retain their privacy, invalid-option, invalid-seat,
priority, and restart assertions against canonical Utopia Sprawl. This does not
claim the removed legacy action's serialized payload is backward compatible.

Existing canonical behavior owners:

- `dsl/entryReplacements.test.ts`: “self-entry color choice applies prospectively before the battlefield move commits”, including a restored pending choice.
- `dsl/entryReplacement.integration.test.ts`: “as-this-enters color choice completes before the entry trigger is captured” and “JSON-restore of the pending color choice still yields exactly one entry trigger”.
- `dsl/entryReplacements.test.ts`: “the life choice is private to its controller and survives a restart” owns generic replacement-choice privacy and restart behavior.
- `dsl/auraMana.test.ts`: “an Aura enters attached, retains its color choice, and adds mana for the host controller (Utopia Sprawl)”.
- `dsl/cardRuleCatalog.test.ts`: structural registration and composition checks for Utopia Sprawl.
- `live-runner/kernelHost.test.ts`: “a canonical entry choice resumes after a host restart”. The same file's “a typed option choice answers with the offered position when labels repeat” now uses generic `mana-choice` data; it continues to own the host's duplicate-label transport behavior, not the retired color action.

The legacy Aura suite now uses the catalog Utopia Sprawl template for its cast,
chosen-color, and mana assertions, and catalog Yavimaya, Cradle of Growth for
the overlay-Forest assertion. The old action tag is gone from the retained
private projection and selection assertions because those now exercise the
canonical pending choice. The migrated host-restart fixture likewise verifies
restore with canonical entry choice; generic private replacement-choice
behavior remains in its runtime and entry-replacement owners above.
The Aura target-rejection assertion is preserved against the canonical
catalog's declared target clauses, whose diagnostic replaces the legacy
synthetic fixture's “must enchant a forest” prose.

Rules basis: CR 614.1c and 614.12/614.12a cover replacement effects and choices
made as a permanent enters; CR 603.6d covers entry-trigger timing. The canonical
choice is completed before the permanent enters and before its entry triggers
are captured.
