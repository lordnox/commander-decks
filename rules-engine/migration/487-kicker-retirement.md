# Legacy kicker execution retirement — #619

Parent: #487. Starting tree: `5539935a`; follows #617/#618.

Canonical cards already use optional-cost receipts: Tear Asunder conditions target
eligibility on an optional payment; Joint Exploration conditions its later program;
Everflowing Chalice repeats an optional cost and reads its count in an entry
replacement. These card definitions and their structural catalog checks are unchanged.

Removed `plugins/kickCast.ts`, the legacy kicker/multikicker builders/properties,
action expansion and payment surcharge, boolean/count receipt forwarding through
cast/stack/live payloads, the battlefield entry stamp, and its charge-counter
instruction/handler. Removed dormant kicked target/search variants and the
associated pending-search field; remaining generic target/search behavior is kept.
Every `searchCandidates` caller was updated so X remains in the correct argument.
Live-agent guidance now uses canonical action optional-cost selections.

## Assertion ownership

| Retired `plugins/multikicker.test.ts` test | Canonical owner / disposition |
| --- | --- |
| multikicker(cost) builders are independent clones | Obsolete shape/identity assertions for a deleted legacy constructor; not a behavior contract for the canonical builder. |
| N=0 enters with no charge counters | `dsl/entryReplacement.integration.test.ts`, `repeatable additional payments remain available to an as-enters replacement, then clear on departure (0)`: pays zero, restores the journal before resolution, enters without a charge-counter key, retains a zero-count canonical receipt until departure, and clears it before a later entry. Legacy `timesKicked`, `kicked` and `enteredWithTimesKicked` field assertions are retired API contracts. |
| N=3 enters with three charge counters and spends the extra mana | The same test's payment=3 case pays exactly six generic for three canonical {2} payments, restores before entry, and enters with three counters. Its payment=2 case is retained. `dsl/announcement.test.ts`, `pays the complete optional cost %s times and retains the count through restore`, also owns exact zero/one/three payment and receipt behavior. |
| legal actions expose each affordable multikicker count | Existing `dsl/announcement.test.ts`, `action offers fund repeated optional costs through the same announcement transaction`: with five generic and a {2} repeated cost, offers exactly counts 0/1/2, uses `eventsForAvailableAction` for two payments, leaves one generic and resolves the count-dependent effect. Only the canonical selected-cost receipt is retained. |

Existing announcement tests own ordinary nonrepeatable-payment rejection, atomic
insufficient-payment failure and optional-payment target expansion. Existing
`dsl/topDeck.test.ts` owns catalog Joint Exploration's scry/draw/conditional land
program. No per-card or new migration-specific gameplay suite is introduced.

No pinned ownership record has a current destination in the removed suite. The
inventory and progress JSON remain unchanged. Historical source assertions retain
their original names; they are not live imports. The generated coverage ledger
is refreshed and no authoring allowance is added.

CR 702.33a/c/d describe additional and repeatable kicker payments; CR 702.33g
conditions targets on the chosen payment. CR 614.12 handles entry replacements.
These sections were checked in the official 2026-08-19 rules linked from
`rules-sources/README.md`. Canonical receipts preserve the linked payment through
entry; no additional trigger, priority window or compatibility receipt is added.
