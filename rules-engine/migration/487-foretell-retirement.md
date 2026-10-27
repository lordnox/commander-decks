# Legacy Foretell retirement — #627

Parent: #487. Starting tree: `8021e3d5`; follows #626.

Removed the legacy `foretell` `CardEffect` variant, its builder, and the fallback
reader from the Foretell runtime plugin. Foretell remains an engine plugin for
its special action, face-down exile, visibility, and cast lifecycle; its printed
cost now comes only from the canonical DSL zone mechanic. The canonical
`foretell` builder and catalog definition are unchanged.

The old explicit-effects suite was removed after consolidating its behavior
assertions in `dsl/preparedCasting.test.ts`, which authors its fixture with the
canonical `foretell` node:

| Retired assertion | Canonical owner / preserved evidence |
| --- | --- |
| builder stamps a clone-safe legacy effect | Obsolete legacy API shape assertion; canonical catalog structure is checked by `dsl/cardRuleCatalog.test.ts` for Glorious Protector. |
| special action exiles face down, pays `{2}`, and records foretold turn / private knowledge | `foretell prepares a card without the stack and enforces a later-turn cast`: no stack item, exile zone, hand/exile zone order, exact remaining generic mana, `foretold`, `foretoldTurn`, and chooser-only `knownTo`. |
| owner sees the face-down card while opponents do not | Same prepared-casting test checks the owner's projected card and absence of both card identity and exile-zone order from the opponent projection. |
| same-turn cast is rejected | Same test checks the cast is rejected before incrementing the turn. |
| later cast action pays the colored foretell cost and clears face-down status | Same test uses `{1}{U}`, asserts the legal cast action, exact remaining `{C,U}` mana, `castOption`, removal of `foretold` and `foretoldTurn`, and public `knownTo` after casting. |
| foretell action appears in the legal action list during the allowed window | Same test checks `legalActsFor` exposes the special action. `foretell works during your combat with a spell on the stack; plot requires an empty main phase` retains turn/priority timing coverage. |

Rules 116.2h, 116.3, 117.1, and 702.143a–f in the Wizards file linked from
`rules-sources/README.md` inform the preserved special-action timing, cost,
visibility, and later-cast behavior. The coverage ledger is regenerated; no
DSL-authoring allowance is added.
