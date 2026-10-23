# Remaining card dependencies

Companion to the [mechanics-first strategy](CARD-MIGRATION-BATCHES.md). Snapshot: PR #432 after family 35 event-history slices, plus paid-mode composition, convoke, cleave/evoke, conditional spell-cost reductions, shared casting costs/kicker, plus family 23 restricted mana, plus family 32 loyalty and emblems, plus family 21 combat keywords, the family 26 land-permission slice, family 22 and cumulative upkeep, cycling correctness fixes and Alabaster Host Intercessor, plus families 12, 22-land-types, and 31, including Dakmor Salvage, Life from the Loam, Blanket of Night, Urborg, Yavimaya, Waterlogged Teachings, Myriad Landscape, and Finale of Devastation, plus the prior Sail into the West / Mirkwood Bats and families 38 and 40. **59 exact legacy registration keys**, each listed once below; aliases/faces can describe the same physical card. The old primary group is retained only as **Former batch**. A card can require mechanics from any family.

**Required mechanics** lists known direct prerequisites, including relevant already-available support. Follow each mechanic's prerequisite links as well; readiness below includes those transitive dependencies. Ordinary existing canonical operations are assumed. No row authorizes omitting an unlisted printed ability: review the complete current Oracle text/rulings before implementation and add any discovered prerequisite.

Current readiness: **0 composition candidates**; **59 blocked or awaiting source review**. A composition candidate has no *known* open mechanic gate; it is still unmigrated and unverified as a complete card. Every row needs that full-card review before migration. Source-review flags identify especially incomplete planning inputs.

| Exact card registration | Former batch | Required mechanics | Next action | Scope notes |
| --- | --- | --- | --- | --- |
| `All-Fates Stalker` | 18 | [18-duration](CARD-MIGRATION-BATCHES.md#18-duration), [25-warp](CARD-MIGRATION-BATCHES.md#25-warp) | Blocked by mechanics | — |
| `Analyze the Pollen` | 25 | [25-evidence](CARD-MIGRATION-BATCHES.md#25-evidence) | Blocked by mechanics | — |
| `Ancient Greenwarden` | 26 | [26-graveyard-lands](CARD-MIGRATION-BATCHES.md#26-graveyard-lands), [29-multiply](CARD-MIGRATION-BATCHES.md#29-multiply), [21-reach](CARD-MIGRATION-BATCHES.md#21-reach) | Blocked by mechanics | — |
| `Angel of Sanctions` | 18 | [18-duration](CARD-MIGRATION-BATCHES.md#18-duration), [25-embalm](CARD-MIGRATION-BATCHES.md#25-embalm) | Blocked by mechanics | — |
| `Belonging` | 41 | [41-encore](CARD-MIGRATION-BATCHES.md#41-encore), [22-changeling](CARD-MIGRATION-BATCHES.md#22-changeling) | Blocked by mechanics | — |
| `Blightsteel Colossus` | 42 | [42-shuffle](CARD-MIGRATION-BATCHES.md#42-shuffle), [21-infect](CARD-MIGRATION-BATCHES.md#21-infect) | Blocked by mechanics | — |
| `Cling to Dust` | 25 | [25-escape](CARD-MIGRATION-BATCHES.md#25-escape) | Blocked by mechanics | — |
| `Concordant Crossroads` | 21 | [21-static](CARD-MIGRATION-BATCHES.md#21-static), [42-world](CARD-MIGRATION-BATCHES.md#42-world) | Blocked by mechanics | World supertype requires the world state-based rule; haste grants alone are insufficient. |
| `Círdan the Shipwright` | 39 | [39-secret](CARD-MIGRATION-BATCHES.md#39-secret) | Blocked by mechanics | Retain both entry and attack triggers. |
| `Darksteel Colossus` | 42 | [42-shuffle](CARD-MIGRATION-BATCHES.md#42-shuffle) | Blocked by mechanics | — |
| `Dread Return` | 25 | [25-flashback](CARD-MIGRATION-BATCHES.md#25-flashback) | Blocked by mechanics | — |
| `Ephemerate` | 30 | [28-rebound](CARD-MIGRATION-BATCHES.md#28-rebound) | Blocked by mechanics | — |
| `Erestor of the Council` | 39 | [39-finished](CARD-MIGRATION-BATCHES.md#39-finished) | Blocked by mechanics | Observe finished votes, compare each opponent's choices with yours, create Treasures, scry the counted opponents, then draw. |
| `Eureka` | 27 | [27-repeat](CARD-MIGRATION-BATCHES.md#27-repeat) | Blocked by mechanics | — |
| `Everybody Lives!` | 42 | [42-player](CARD-MIGRATION-BATCHES.md#42-player) | Blocked by mechanics | Creature hexproof/indestructible and player hexproof plus life/game-result restrictions. |
| `Firdoch Core` | 24 | [24-animation](CARD-MIGRATION-BATCHES.md#24-animation), [22-changeling](CARD-MIGRATION-BATCHES.md#22-changeling) | Blocked by mechanics | — |
| `Forgotten Cellar` | 26 | [43-room](CARD-MIGRATION-BATCHES.md#43-room), [26-graveyard-lands](CARD-MIGRATION-BATCHES.md#26-graveyard-lands), [26-graveyard-spells](CARD-MIGRATION-BATCHES.md#26-graveyard-spells), [26-graveyard-replacement](CARD-MIGRATION-BATCHES.md#26-graveyard-replacement) | Blocked by mechanics | 43-room is available. Same physical Room as Walk-In Closet: still needs both graveyard doors and exile replacement. |
| `Fortune's Favor` | 39 | [39-hidden](CARD-MIGRATION-BATCHES.md#39-hidden) | Blocked by mechanics | — |
| `Glorious Protector` | 18 | [18-duration](CARD-MIGRATION-BATCHES.md#18-duration), [25-foretell](CARD-MIGRATION-BATCHES.md#25-foretell) | Blocked by mechanics | — |
| `Hall of Storm Giants` | 24 | [24-animation](CARD-MIGRATION-BATCHES.md#24-animation), [17-entry](CARD-MIGRATION-BATCHES.md#17-entry), [21-ward](CARD-MIGRATION-BATCHES.md#21-ward) | Blocked by mechanics | — |
| `Hedge Shredder` | 24 | [24-crew](CARD-MIGRATION-BATCHES.md#24-crew), [35-group](CARD-MIGRATION-BATCHES.md#35-group) | Blocked by mechanics | 35-group is available; still needs crew. |
| `Hostile Negotiations` | 08 | [08](CARD-MIGRATION-BATCHES.md#08), [39-hidden](CARD-MIGRATION-BATCHES.md#39-hidden) | Blocked by mechanics | Reuse public/private inspection; hidden piles, opponent choice, result routing, and life loss compose afterward. |
| `Hypergenesis` | 27 | [27-repeat](CARD-MIGRATION-BATCHES.md#27-repeat), [25-suspend](CARD-MIGRATION-BATCHES.md#25-suspend) | Blocked by mechanics | — |
| `Illusion of Choice` | 39 | [39-control](CARD-MIGRATION-BATCHES.md#39-control) | Blocked by mechanics | — |
| `Incarnation Technique` | 44 | [28-demonstrate](CARD-MIGRATION-BATCHES.md#28-demonstrate) | Blocked by mechanics | — |
| `Irenicus's Vile Duplication` | 28 | [28-modifiers](CARD-MIGRATION-BATCHES.md#28-modifiers) | Blocked by mechanics | — |
| `Kederekt Leviathan` | 30 | [30-unearth](CARD-MIGRATION-BATCHES.md#30-unearth) | Blocked by mechanics | — |
| `Kuroki, Thief of Talents` | 44 | [13-step](CARD-MIGRATION-BATCHES.md#13-step), [26-hand](CARD-MIGRATION-BATCHES.md#26-hand), [21-menace](CARD-MIGRATION-BATCHES.md#21-menace) | Blocked by mechanics | Opponent chooses whether to draw; cast from that opponent's private hand or put counters on Kuroki. |
| `Lair of the Hydra` | 24 | [24-animation](CARD-MIGRATION-BATCHES.md#24-animation), [17-entry](CARD-MIGRATION-BATCHES.md#17-entry) | Blocked by mechanics | Retain the nonzero-X bound on its animation activation. |
| `Mirrorweave` | 28 | [28-temporary](CARD-MIGRATION-BATCHES.md#28-temporary) | Blocked by mechanics | — |
| `Nanogene Conversion` | 28 | [28-temporary](CARD-MIGRATION-BATCHES.md#28-temporary) | Blocked by mechanics | — |
| `Parting Gust` | 25 | [25-gift](CARD-MIGRATION-BATCHES.md#25-gift) | Blocked by mechanics | — |
| `Perch Protection` | 42 | [42-player](CARD-MIGRATION-BATCHES.md#42-player), [42-turn](CARD-MIGRATION-BATCHES.md#42-turn) | Blocked by mechanics | Full gift, four Birds, phase-out, protection duration, and resolving exile. |
| `Pitiless Carnage` | 09 | [09-count](CARD-MIGRATION-BATCHES.md#09-count), [25-plot](CARD-MIGRATION-BATCHES.md#25-plot) | Blocked by mechanics | — |
| `Portal to Phyrexia` | 37 | [37-sacrifice](CARD-MIGRATION-BATCHES.md#37-sacrifice), [13-step](CARD-MIGRATION-BATCHES.md#13-step), [22-types](CARD-MIGRATION-BATCHES.md#22-types) | Blocked by mechanics | Upkeep reanimation adds the Phyrexian type without replacing the original types. |
| `Quantum Misalignment` | 28 | [28-modifiers](CARD-MIGRATION-BATCHES.md#28-modifiers), [28-rebound](CARD-MIGRATION-BATCHES.md#28-rebound) | Blocked by mechanics | — |
| `Rankle, Master of Pranks` | 37 | [37-sacrifice](CARD-MIGRATION-BATCHES.md#37-sacrifice), [37-modes](CARD-MIGRATION-BATCHES.md#37-modes), [34-damage](CARD-MIGRATION-BATCHES.md#34-damage) | Blocked by mechanics | Combat-damage-to-player occurrence; retain all printed keywords and every mode. |
| `Reins of Power` | 28 | [28-exchange](CARD-MIGRATION-BATCHES.md#28-exchange) | Blocked by mechanics | — |
| `Rings of Brighthearth` | 29 | [29-activation](CARD-MIGRATION-BATCHES.md#29-activation) | Blocked by mechanics | — |
| `Rishkar's Expertise` | 14 | [14-greatest](CARD-MIGRATION-BATCHES.md#14-greatest), [14-filter](CARD-MIGRATION-BATCHES.md#14-filter), [26-hand](CARD-MIGRATION-BATCHES.md#26-hand) | Blocked by mechanics | — |
| `Roaming Throne` | 29 | [29-multiply](CARD-MIGRATION-BATCHES.md#29-multiply), [22-choose-type](CARD-MIGRATION-BATCHES.md#22-choose-type), [21-ward](CARD-MIGRATION-BATCHES.md#21-ward) | Blocked by mechanics | — |
| `Sakashima of a Thousand Faces` | 28 | [28-entry](CARD-MIGRATION-BATCHES.md#28-entry), [28-legend](CARD-MIGRATION-BATCHES.md#28-legend) | Blocked by mechanics | — |
| `Show and Tell` | 27 | [27-place](CARD-MIGRATION-BATCHES.md#27-place) | Blocked by mechanics | — |
| `Six` | 26 | [26-retrace](CARD-MIGRATION-BATCHES.md#26-retrace), [07-mill](CARD-MIGRATION-BATCHES.md#07-mill), [21-reach](CARD-MIGRATION-BATCHES.md#21-reach) | Blocked by mechanics | Reach; attack mill and optional land recovery only from the milled set. |
| `Snuff Out` | 25 | [25-alternative](CARD-MIGRATION-BATCHES.md#25-alternative), [42-regeneration](CARD-MIGRATION-BATCHES.md#42-regeneration) | Blocked by mechanics | — |
| `Soul of Eternity` | 41 | [41-encore](CARD-MIGRATION-BATCHES.md#41-encore), [22-characteristics](CARD-MIGRATION-BATCHES.md#22-characteristics) | Blocked by mechanics | — |
| `Spark Double` | 28 | [28-entry](CARD-MIGRATION-BATCHES.md#28-entry), [17-counters](CARD-MIGRATION-BATCHES.md#17-counters) | Blocked by mechanics | — |
| `Springheart Nantuko` | 41 | [41-bestow](CARD-MIGRATION-BATCHES.md#41-bestow), [07](CARD-MIGRATION-BATCHES.md#07) | Blocked by mechanics | Include attached +1/+1, optional copy payment, and fallback Insect only when no copy was created. |
| `Thespian's Stage` | 28 | [28-temporary](CARD-MIGRATION-BATCHES.md#28-temporary) | Blocked by mechanics | Permanent-duration copy with its own copy ability retained, not a token. |
| `Trap the Trespassers` | 39 | [39-secret](CARD-MIGRATION-BATCHES.md#39-secret), [39-object](CARD-MIGRATION-BATCHES.md#39-object) | Blocked by mechanics | Secret votes name creatures; put vote-count stun counters and tap. Existing stun-counter untap semantics are reusable; no skip-next-untap mechanic is required. |
| `Valgavoth, Terror Eater` | 26 | [26-exile](CARD-MIGRATION-BATCHES.md#26-exile), [21-ward-sacrifice](CARD-MIGRATION-BATCHES.md#21-ward-sacrifice), [21-lifelink](CARD-MIGRATION-BATCHES.md#21-lifelink) | Blocked by mechanics | — |
| `Vanish into Memory` | 30 | [30-return-result](CARD-MIGRATION-BATCHES.md#30-return-result) | Blocked by mechanics | — |
| `Vantress Visions` | 29 | [29-copy](CARD-MIGRATION-BATCHES.md#29-copy), [43-adventure](CARD-MIGRATION-BATCHES.md#43-adventure), [29-multiply](CARD-MIGRATION-BATCHES.md#29-multiply) | Blocked by mechanics | Alias/Adventure face of Virtue of Knowledge; require complete shared physical-card behavior. |
| `Virtue of Knowledge` | 29 | [29-copy](CARD-MIGRATION-BATCHES.md#29-copy), [29-multiply](CARD-MIGRATION-BATCHES.md#29-multiply), [43-adventure](CARD-MIGRATION-BATCHES.md#43-adventure) | Blocked by mechanics | — |
| `Walk-In Closet` | 26 | [43-room](CARD-MIGRATION-BATCHES.md#43-room), [26-graveyard-lands](CARD-MIGRATION-BATCHES.md#26-graveyard-lands), [26-graveyard-spells](CARD-MIGRATION-BATCHES.md#26-graveyard-spells), [26-graveyard-replacement](CARD-MIGRATION-BATCHES.md#26-graveyard-replacement) | Blocked by mechanics | 43-room is available. Same physical Room as Forgotten Cellar: still needs both graveyard doors and exile replacement. |
| `Will of the Sultai` | 14 | [25-modal](CARD-MIGRATION-BATCHES.md#25-modal) | Blocked by mechanics | Count lands and retain the commander-dependent announcement choice. |
| `Woodfall Primus` | 30 | [30-persist](CARD-MIGRATION-BATCHES.md#30-persist) | Blocked by mechanics | — |
| `Yarok, the Desecrated` | 29 | [29-multiply](CARD-MIGRATION-BATCHES.md#29-multiply), [21-lifelink](CARD-MIGRATION-BATCHES.md#21-lifelink) | Blocked by mechanics | — |
| `Zanarkand, Ancient Metropolis // Lasting Fayth` | 43 | [43-adventure](CARD-MIGRATION-BATCHES.md#43-adventure), [38-token-refs](CARD-MIGRATION-BATCHES.md#38-token-refs) | Blocked by mechanics | Create the Hero, then put counters on that new token equal to your land count; retain the tapped land face and Adventure permission. |

## Original group 08 cards that were blocked

| Card | Available support | Remaining mechanics |
| --- | --- | --- |
| Hostile Negotiations | 08: library inspection and visibility primitives | 39-hidden, built on 39-piles and 15-player |

These cards no longer keep mechanic 08 open. Their rows above remain blocked until the listed missing mechanics and their prerequisites are available.
