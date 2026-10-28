# Retire the legacy enchanted-land mana boost

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)

Child: [#645](https://github.com/lordnox/commander-decks/issues/645)

Base: `ca71ef3a`

This slice removes the legacy `CardEffect.enchantedManaBoost` field and builder,
the `enchantedManaBoost` runtime plugin, and its optional-format and built-in
plugin registrations. No catalog card used that path. Wild Growth and Utopia Sprawl
already express their mana triggers through canonical `tappedForMana` abilities;
their card definitions and shared tap-event behavior remain unchanged.

The legacy Aura behavior suite now uses catalog Wild Growth and Utopia Sprawl,
catalog Yavimaya, Cradle of Growth, and catalog Flooded Grove. The Filter Land
assertion still pays `{G/U}`, taps the land, selects `UU`, and verifies both
the selected two blue mana and Wild Growth's green bonus. The multiple-Aura,
host departure, action target/rejection, overlay-Forest, and chosen-color
assertions remain. Only plugin-wiring and plugin-rule-receipt checks are
retired; their asserted plugin registration and `pluginId` receipt were
specific to the removed implementation.

Existing owners:

- `cardPlugins/enchantedManaBoost.test.ts`: retained Aura target enumeration and rejection, target departure before resolution, host mana ability and off-host restriction, catalog Flooded Grove activation, multiple Auras, host departure, private Utopia Sprawl color choice, and overlay-Forest bonus.
- `cardPlugins/dsl/auraMana.test.ts`: catalog Aura attachment, host-controller mana, Utopia Sprawl color, host departure, typed enchant restriction, and cleanup when the host stops qualifying.
- `cardPlugins/dsl/tapOccurrences.test.ts`: canonical tapped-for-mana triggers happen once after a restored mana choice, do not fire for ordinary taps, and retain the occurrence when a mana ability sacrifices its source.
- `cardPlugins/dsl/cardRuleCatalog.test.ts`: structural composition of Wild Growth and Utopia Sprawl enchant restrictions and tapped-for-mana triggers.

The canonical triggered mana abilities rely on CR 605.1b and are observed on
actual mana-production events. Aura targeting and cleanup follow CR 303.4a,
303.4c, and 303.4e. This migration preserves existing behavior owners without
adding card definitions or new legacy authoring.
