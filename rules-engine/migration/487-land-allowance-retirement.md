# Legacy land-play allowance retirement — #615

Parent: #487. Starting tree: `50f72d8a`; follows #613/#614.

The canonical static modifier reader and typed `grantLandPlays` event now own
allowance calculation. Removed the legacy static property/constructor, instruction
variant/constructor/handler, `effectsOf` reader and `additionalLandPlay.grant`
custom-event route. Neither removed constructor had a remaining caller. The only
production custom-event producer was the removed instruction handler; the other
callers were in the retired `additionalLandPlay.test.ts` suite.

The canonical card definitions, typed grant event, temporary-grant storage key,
and cleanup/untap reset timing remain unchanged. No new authoring allowance is
needed. The pinned ownership inventory and its progress records are unchanged:
none of their current destinations was the removed suite. The documented Icetill
handler reference in #402 is retained: the generic `additionalLandPlay` plugin
still runs its canonical allowance calculation.

## Assertion ownership

All land-play assertions below live in `dsl/extraLandPlays.test.ts`.

| Removed test | Canonical owner / preserved behavior |
| --- | --- |
| a seat with no source keeps the single land play | `without a source a seat has only its normal land play`: allowance one, spent one, second play rejected. |
| Aesi on the battlefield allows a second land | Existing `a nameless fixture grants one additional land play on the battlefield`: allowance two and two successful land plays. Aesi's optional landfall draw stays owned by unchanged `landfall.test.ts` (`Aesi draws through the shared instruction runner`); generic accept/decline continuation remains owned by `dsl/may.test.ts`. The allowance test no longer opens an unrelated draw trigger. |
| the extra land play leaves when the permanent does | `removing a static source preserves spent plays and restores the base allowance`: two spent plays stay spent when allowance returns to one; another play is rejected. |
| two static sources stack | `static sources stack with grants and leaving sources remove only their own allowance`: two statics plus one grant produce four; departure of each static reduces allowance by one and leaves the grant intact. |
| Summer Bloom grants three land plays on resolution | `a resolving grant of 3 composes with drawing and expires at the next untap`: allowance four, spell goes to graveyard. Catalog structural checks continue to verify the actual card's grant count. |
| Explore also draws a card | The count-one parameter of that same generic program: allowance two, exact drawn Forest in hand. Catalog structural checks retain the card's grant/draw composition. |
| a one-turn grant ends when the next turn starts | Both resolving-grant parameter cases advance through cleanup to untap and assert allowance returns to one. Existing journal-restore test separately verifies cleanup expiry alongside a surviving static and spent counts. |

The source-departure assertions follow CR 305.2/305.2a/305.2b: current allowance
is compared with the number of lands already played. Temporary grants continue
to expire at cleanup under CR 514.2. Checked against the official 2026-08-19
Comprehensive Rules download linked in `rules-sources/README.md`.
