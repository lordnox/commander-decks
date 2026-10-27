# Legacy Spree execution retirement — #617

Parent: #487. Starting tree: `c0dad0e0`; follows #615/#616.

The legacy `spreeCast` plugin was used only by its explicit-effects fixture suite.
It had its own string-mode dialog, custom continuation, player-data resume object,
mode-cost helper and action expansion. All supported catalog cards already use
canonical programs. In particular, Getaway Glamer uses bounded optional costs and
`paidCostCount` to execute its selected programs, not the legacy string-mode API.
Its definition and existing announcement integration tests are unchanged.

Removed the plugin, `spreeCost.ts`, legacy constructors/types/effect property and
`spreeModes` forwarding from action offers, payment previews, cast events, stack
items and the live protocol. Canonical optional-cost receipts and the driver own
payment and program progression. No runtime/source reference to those legacy
symbols remains; historical pinned audit evidence remains unchanged.

## Assertion ownership

| Retired `spreeCast.test.ts` test | Canonical owner / preserved behavior |
| --- | --- |
| opens Spree mode choice before paying mana, then casts with selected modes | `dsl/announcement.test.ts`, `paid optional programs charge their selected costs once`: canonical action offers expose the three valid subsets without mutating mana/state, selected cost index 1 charges printed plus optional mana, resolves two draws and puts the spell in the graveyard with an empty stack. The private pending-dialog shape is a retired API contract: canonical optional-cost selection is part of the supplied action, not a separate custom dialog. Private resolution choices are covered by the paid-scry test below. |
| casting with explicit spreeModes pays combined costs and runs each mode | The same test's indices [0,1] case uses `eventsForAvailableAction`, spends exactly one blue plus four generic, survives journal restore, and draws exactly three cards. Existing generic optional-payment tests retain repeated/nonrepeatable cost and receipt assertions. |
| a paid mode that scrys finishes through selectCards | `dsl/topDeck.test.ts`, `a paid scry program suspends later paid programs through restore (draw=false)`: full printed/optional payment, typed one-card scry, bottom placement, cleared choice/resolution/stack and spell in graveyard. |
| does not run later paid modes while an earlier mode still owes selectCards | The draw=true case of that test asserts empty hand, source still on stack, null priority and chooser-only picker before journal restore; restored selection identity is stable. Only after answering does the later paid draw execute and resolution finish. The canonical resolution frame replaces `spreeCast.resume`; no separate resume-data representation is retained. |
| rejects casting with no modes or unknown mode ids | The paid optional-program announcement test rejects empty, out-of-range and duplicate optional-cost indices with the original state unchanged. Existing `optional payment bounds activate only the selected target clauses and programs` tests own min/max selection bounds and selected-target composition. Legacy error strings and string-mode IDs are retired API contracts. |

No current ownership-audit destination points at the removed suite. The pinned
inventory and progress files are unchanged, including historical handler-list
assertions retained as evidence of the source revision rather than live imports.
The coverage ledger is regenerated; authoring enforcement still has zero explicit
migration allowances. No canonical card definition changes.

CR 601.2b places additional-cost choices at announcement; CR 117.2e gives no
priority during resolution; CR 608.2c processes instructions in printed order.
These sections were checked in the official 2026-08-19 Comprehensive Rules linked
from `rules-sources/README.md`; no new priority window or competing executor is added.
