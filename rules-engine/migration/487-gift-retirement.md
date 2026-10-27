# Legacy gift casting retirement — #621

Parent: #487. Starting tree: `ed0d7f43`; follows #619/#620.

Catalog gift cards already use canonical optional `choosePlayer` costs and paid
receipts. Removed the separate `giftCast` recipient picker/delivery plugin,
`GiftSpec`/builder, gift flag conditions and wrappers, legacy action expansion,
cast/stack/live flags and `finishGiftCast` player-choice action. Generic typed
player selections remain. Collector's Vault's test no longer installs the unused
gift plugin; its assertions and runtime behavior are otherwise unchanged.
Canonical card definitions are unchanged.

## Assertion ownership

| Retired `giftCast.test.ts` test | Current owner / preserved behavior |
| --- | --- |
| Perch Protection gifts an extra turn and phases out on the promised gift | Moved to `dsl/extraTurns.test.ts`: the existing catalog integration still offers p2/p3/p4, records the optional-player receipt for p2, creates four Birds, phases Held Bear and grants p2 an extra turn. The test uses the catalog template and standard canonical runtime without the legacy plugin. |
| Perch Protection gift recipient survives JSON restore and is hidden from another player | Moved to the same suite with the same title: receipt for p3 survives JSON restore, p2 has no pending selection for p1, and resolution grants p3 the extra turn. |
| promised gift creates a tapped token for the chosen opponent before other effects | `dsl/announcement.test.ts`, `optional player receipts control delivery and both program branches after restore (promised=true)`: no token or recipient draw at cast time; after restore, resolution creates exactly one tapped 1/1 Fish for p2, draws for p1 and p2, and leaves p3 without tokens. Existing generic token occurrence/entry suites retain token event ordering; the retired test asserted final token/draw state rather than a distinct ordering observation. |
| ifGiftPromised branches on the stack item without card names | Both parameters of the same generic test use a paid-cost conditional: selected receipt draws for p2 and grants p1 five life; omission leaves p2's hand unchanged and grants p1 one life. This replaces legacy flag branching with canonical receipt branching. |
| opens selectPlayers when gift is promised without a recipient | The legacy pending announcement shape is retired. Existing `optional player choices as casting costs` announcement tests own living-opponent offers and atomic rejection of missing/self/invalid/unsolicited cost-player choices. Canonical announcements supply the chosen player in the action and do not create `finishGiftCast`. |
| generic finishGiftCast recipient selection survives JSON restore and stays private | Its legacy state shape is retired with the plugin. The moved Perch catalog integration preserves receipt/benefit restore, and generic optional-player announcement tests retain canonical receipts through journal restore. Existing `playerPrograms.test.ts` owns reusable private typed player choices and restore; no duplicate picker implementation is retained. |

The two #403 destination records now point to `dsl/extraTurns.test.ts`, with
explicit evidence distinguishing canonical supplied-cost choices from the deleted
legacy picker. The pinned inventory and all implemented IDs are unchanged.
The coverage ledger is refreshed; no authoring allowance is added.

CR 601.2b places additional-cost choices at announcement and CR 608.2c follows
resolution instructions in order. These were checked in the official 2026-08-19
rules linked from `rules-sources/README.md`. No new priority window or separate
gift executor is introduced.
