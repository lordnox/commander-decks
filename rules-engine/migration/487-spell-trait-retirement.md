# Legacy spellTrait retirement — #625

Parent: #487. Starting tree: `068d1a96`; follows #623/#624.

Removed the legacy `spellTrait` effect variant, `uncounterable()` effect builder,
and the `cannotBeCountered` fallback reader in `plugins/spells.ts`. Canonical
spell properties, printed static `cannotBeCountered`, and restricted-mana
uncounterability receipts remain unchanged. No card catalog definitions change.

Both remaining fixtures belong to the reusable `dsl/targeting.test.ts` suite:

- The Ward fixture now authors `spell({ uncounterable: true, ... })` instead of
  mixing a canonical program with a legacy effect. Its title now describes its
  existing assertions correctly: declining Ward leaves the spell on the stack.
  The private choice, trigger controller after control changes, priority lock,
  projection and restore assertions remain intact. It also asserts the canonical
  stack protection flag. The neighboring ordinary-Ward test still checks that
  declining Ward counters an ordinary spell by its pinned stack identity.
- The counter-target fixture now uses a minimal canonical uncounterable spell.
  It retains legal counter targeting, the protected target remaining stacked and
  the counter program's subsequent life gain, and checks the stack protection
  flag explicitly.

Existing `dsl/counter.test.ts` owns canonical spell/static uncounterability,
continued resolution and printed permanent entry after an unsuccessful counter;
`targetingMana.test.ts` owns the restricted-mana receipt. Those cases are reused,
not copied into a migration suite. Rules 101.2, 608.2b, 701.6 and 702.21 in the
Wizards file linked by `rules-sources/README.md` inform the preserved behavior.

The generated coverage ledger is refreshed. Pinned inventory/progress IDs and
assertion owners remain unchanged. No authoring allowance is added. Remaining
legacy runtime removal stays in #487 and scaffolding removal stays in #464.
