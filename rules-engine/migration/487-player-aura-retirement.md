# Retire the dormant player-Aura compatibility route

Parent: [#487](https://github.com/lordnox/commander-decks/issues/487)  
Child: [#639](https://github.com/lordnox/commander-decks/issues/639)  
Base: `23b74da3`

This change removes the unused `playerAuraDeal` effect variant and builder, the
uninstalled `attackDeal` plugin, and the action-reader fallbacks that recognized
that effect. Canonical player-Aura targeting through `enchantPlayerTargets`
remains in place. No legacy assertions existed for the removed route, so there
are no old assertions to map or claim as migrated.

Existing canonical tests currently own related behavior:

- `dsl/attachments.test.ts`: “catalog Tenuous Truce attaches to an opponent,
  draws at their end step, and breaks on attacks” covers the named card's
  canonical attachment and triggered behavior.
- `dsl/targeting.test.ts`: “live action enumeration exposes catalog Tenuous
  Truce opponents and Sokrates creature targets” covers action enumeration of
  the canonical player target.
- `dsl/cardRuleCatalog.test.ts`: “family 22 catalog composes characteristics,
  types, grants, and attachments” checks Tenuous Truce's canonical
  registration and rule composition structurally.

These tests demonstrate current canonical ownership. They do not assert that
every branch of the removed compatibility implementation had equivalent test
coverage. Aura attachment rules are covered by Comprehensive Rules 303.4;
attacking and triggered-ability timing are covered by 508.1m and 603.2.
