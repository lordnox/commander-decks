# Legacy hand-size retirement — #613

Parent: #487. Starting tree: `82a40dce`.

The only importer of `noMaxHand.ts` was `seaGate.test.ts`. That suite was also
the only caller of the legacy `drawHandSize` and `noMaximumHandSize`
constructors. Their instruction variants, constructors and resource handlers are
removed together. Canonical card definitions and the canonical driver are unchanged.
No baseline allowance covered these removed generic paths; the authoring check
continues to pass with zero explicit allowances.

## Assertion ownership

| Removed legacy test | Current mechanic owner / disposition |
| --- | --- |
| instructions are clone-safe | Obsolete constructor-shape assertions for the deleted legacy instruction API; not a canonical behavior contract. |
| draws cards equal to the hand at resolution plus one | `dsl/grantNoMaximumHandSize.test.ts`, `a resolving grant survives the source leaving and skips cleanup discard`: a minimal draw/count/add program draws 9 from a 12-card library with 8 cards held after casting; both hand and library lengths are asserted. Existing catalog composition checks remain structural in `dsl/cardRuleCatalog.test.ts`. |
| lifts the maximum for that player only, and cleanup then needs no discard | Same grant test asserts controller-only benefit and successful cleanup with more than seven cards; existing canonical catalog integration is also retained. |
| without the flag cleanup still demands a discard | `dsl/maximumHandSize.test.ts`, `a canonical static removes only its controller cleanup limit and survives restore`: after source departure, the nine-card hand must discard two. |
| survives a static no-max-hand source leaving the battlefield | The grant mechanic test resolves a permanent grant alongside a canonical static source, removes that static source, checks no configured-limit mutation, and verifies the permanent grant still skips cleanup. |
| a player without the flag keeps the default maximum when a tower leaves | The static mechanic test above checks the return to seven and required discard. `source removal preserves separately configured limits and permanent unlimited grants` additionally covers a configured limit of five. |
| the life choice is private to its controller and survives a restart | Moved to `dsl/entryReplacements.test.ts` under the existing pay-life-or-tap catalog integration. Same production catalog template route, chooser-only projection, structured-clone restart, selection identity and exact three-life payment. #403 group `cirdanPartBMana:751` points to the new owner; its pinned inventory is unchanged. |

The source/controller, configured-limit, phase/control-change, stacking and restore
coverage already in `dsl/maximumHandSize.test.ts` remains. No legacy hand-size
fixture or separate executor is needed for these supported canonical behaviors.
