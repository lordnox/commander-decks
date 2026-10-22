# Card migration strategy: mechanics first

Snapshot: PR #432 after nonnegative differences and counter-count amounts; continues #394 and #383. **138 legacy registration keys remain.** This counts exact registration keys, including aliases/faces, rather than distinct physical cards. Black Sun's Twilight is now canonical, along with the prior snapshot's catalog cards.

Implement reusable mechanics independently, then migrate every card whose complete set of prerequisites is available. A card can depend on several mechanics and does not belong to one implementation group. Completing a mechanic does not require migrating cards blocked by another mechanic.

**170 mechanic entries:** 54 available, 1 awaiting correctness follow-up, and 115 open work items. These are planning slices, not equal effort units. Counts of dependent cards overlap and must not be added.

## How to use this plan

1. Choose a focused **Open** mechanic, preferably one that completes the prerequisites of several cards. Check its prerequisite mechanics first.
2. Verify current canonical support, current Oracle text/rulings, and matching GitHub reports. An open item describes the remaining contract to validate or implement; it does not imply that all of its infrastructure is absent. Split a large item further before coding when needed.
3. Implement the reusable typed DSL schema, compiler/runtime semantics, and mechanic-owned behavior tests. Mark it **Available** only when its whole stated contract is supported. Push that coherent commit to #432.
4. Re-evaluate the [card dependency list](CARD-MIGRATION-DEPENDENCIES.md), including transitive prerequisites. Cards with no known open prerequisite become **Composition candidates**, subject to full-card review. Verify every printed ability, face, cost, keyword, and alias before moving them; add any newly discovered dependency first.
5. Compose the ready card in its own canonical `src/cards/<card-name>.ts` file. Keep named-card catalog tests structural, reuse existing mechanic coverage, remove the legacy registration and stale allowance, regenerate the coverage ledger, and push the card commit. A mechanic and its first cards can share one coherent commit when that is clearer.
6. Stop at a sensible boundary when the next card needs a substantial missing mechanic. Report the completed mechanic/cards, the remaining dependencies, and why work stopped. Do not describe an entire card as migrated when only one behavior is canonical.

No new legacy behavior or baseline allowances. Keep the existing one-PR workflow and push each completed step. Hosted CI is inspected but not awaited on this branch, as requested.

## Status and evidence

- **Available:** reusable canonical support exists for the stated scope. This does not assert complete engine coverage beyond that scope.
- **Review:** canonical support exists, but identified correctness work remains. Cycling issues [#440](https://github.com/lordnox/commander-decks/issues/440) and [#441](https://github.com/lordnox/commander-decks/issues/441) are explicit gates, not silently completed work.
- **Open:** implement or verify the missing reusable contract before depending on it. Multiple keywords/cost variants inside a row may warrant separate commits.
- **Composition candidate:** all *known* mechanic dependencies are available; still needs current Oracle/ruling review and composition validation. This is not a claim that the card is implemented.
- **Source review:** the planning lookup did not resolve a complete cached source for that card. Its dependency set is provisional; resolve the complete specification before claiming readiness.

Sources: the current canonical [schema](../src/cardPlugins/dsl/schema/v1.ts), builders/runtime, [coverage ledger](rule-dsl-coverage-ledger.json), legacy registrations, prior migration inventory, and cached `cards/*.json`. This is a dependency-planning pass, not a fresh live Oracle audit of all 173 registrations. Ordinary supported operations (draw, gain/lose life, selectors, typed choices, counters, moves, modes, and similar composition) are assumed; the lists emphasize additional mechanics and relevant already-available shared dependencies.

## What changed from the card batches

The historical family numbers 01–44 remain stable for earlier discussions. Suffixes identify independent mechanic work inside a family. A numbered family is a navigation heading, not a requirement to finish all of its rows together. New cross-family dependencies are explicit. The old unique card-to-batch ownership rule is retired. The **Former batch** column in the card list is historical provenance only.

- **08 is available:** bounded top-library selection is complete as a mechanic. Six original cards have migrated, including Dack Fayden, Helping Hand. Dig Through Time has migrated with **25-delve**. Famished Worldsire still needs **21-ward**; Hostile Negotiations still needs **39-hidden**.
- **09-count is available:** Reprocess, Scapeshift, and Victimize have migrated. Pitiless Carnage still needs plot. Deferred choices for the same player now reopen correctly (#444).
- **09-devour is available:** entry-replacement devour chooses eligible permanents, sacrifices as the creature enters, and stamps +1/+1 counters from the actual count before ETB observers and SBAs. Land devour is included. Famished Worldsire still needs **21-ward**.
- **13-step is available:** native step triggers and their active-player context are canonical. Dark Confidant, Dark Tutelage, Braids, and Arcane Denial have migrated. Delayed callbacks can exclude the current turn.
- **13-delayed-main is available:** next precombat or postcombat main of a specified player, whichever occurs first, retains captured amounts after the source leaves. Mana Drain has migrated.
- **14-add is available:** unsigned amount addition composes with counts and other amounts. Sea Gate Restoration has migrated with **16-hand-limit** and **16-faces**.
- **14-greatest is available:** maximum power (or toughness, mana value, loyalty) over an object set drives pump and draw. Overwhelming Stampede, Pathbreaker Ibex, and Return of the Wildspeaker have migrated. Rishkar's Expertise still needs **26-hand**.
- **14-filter is available:** object filters compare power, toughness, mana value, or loyalty against X and other amounts, including greatest-power ties. Black Sun's Twilight has migrated. Finale of Devastation still needs **31-multizone**; Getaway Glamer still needs **25-spree**; Profane Command has migrated with **21-fear**; Rishkar's Expertise still needs **26-hand**; Ugin, the Spirit Dragon still needs **32-loyalty**.
- **25-delve is available:** Dig Through Time has migrated. Remaining 25-family costs stay open.
- **07 is available:** both implementation slices landed. Fractured Identity, Settle the Wreckage, and Terastodon are no longer pending.
- **09 separates sacrifice results from devour. 25 separates delve, kicker, evidence, and each alternate cost. 39 separates public piles, hidden piles, public votes, and secret votes.** Implementing one does not require completing its entire former bucket.
- **44 is retired as an implementation group:** its three cards now reference the actual mechanics—demonstrate, timing/hand casting, or counterability.
- Correct planning shortcuts from the former list: Dack is a creature; Bender's Waterskin needs other-player untap participation; Rain of Filth grants activated abilities; Sail into the West uses public voting; Trap the Trespassers uses secret creature votes and existing stun counters. Niv-Mizzet has no established Room dependency.

- **15 is available:** player choice/iteration, commander status, quantified player comparisons, mana-ability filters, and name queries are canonical. Beza, Guardian Project, Field of the Dead, Moonsilver Key, and Singularity Rupture have migrated. Other consumers retain their independent prerequisites.
- **16-hand-limit and 16-stack-object are available:** Sea Gate Restoration // Sea Gate, Reborn and Sink into Stupor // Soporific Springs have migrated with pay-life MDFC composition.

- **17 is available:** conditional tapped entry uses the prospective controller; optional hand reveals use private typed choices followed by public reveal; entry counters accept constants, paid-cost counts on the move, or captured replacement results before observers and state-based actions. Mystic Sanctuary and Choked Estuary have migrated. Hall of Storm Giants/Lair of the Hydra still need animation (and ward for Hall); Mossborn Hydra has migrated with counter-count amounts; Everflowing Chalice, Famished Worldsire, and Spark Double retain their multikicker/ward/copy-entry gates.

- **10-colors is available:** canonical `addManaFrom` queries possible mana types at resolution and in planning, ignoring activation costs/tapped state and propagating types through a finite fixed point. Cyclic pools without a producer contribute no type. Exotic Orchard, Fellwar Stone, Reflecting Pool, and all three Horizon of Progress abilities have migrated; Horizon retains its life payment. The other six mana-production slices are now also available.

- **10 is complete:** all seven mana-production contracts are available. The remaining nine consumers have migrated, preserving hybrid filters, strict mill costs/instant-only timing, actual tap transitions, immediate bonuses, recurring cleanup-scoped callbacks, extort from actual loss, Aura chosen colors/host controllers, and static mana-loss consequences. Typed Aura spell entry is tracked separately as **22-aura**; broader attachment mechanics remain open.

**21-reach and 21-fear are available:** canonical printed and temporary keywords use the shared blocking checks. Fear admits artifact or black creatures and preserves other restrictions. Profane Command has migrated with all four modes; reach consumers retain their other gates.

**21-static and 21-suppress are available:** filtered and conditional keyword grants, conditional stat modifiers, and cannot-have-or-gain suppression use canonical printed-static lifetimes. Thunderfoot Baloth and Archetype of Endurance have migrated. Concordant Crossroads retains its newly identified **42-world** gate.

**14-difference and 14-counters are available:** nonnegative subtraction composes with current counts; named counter amounts preserve captured object identity and read the current count at each instruction. Sandstone Oracle and Mossborn Hydra have migrated, including the former’s non-target opponent choice and the latter’s entry replacement.

## Suggested next work

First review the composition candidates below. Then choose a small mechanic that unlocks cards, rather than implementing entire broad families in numeric order:

| Mechanic | Cards it can unlock after review | Other gates |
| --- | --- | --- |
| [22-land-types](#22-land-types) | Blanket of Night; Urborg, Tomb of Yawgmoth; Yavimaya, Cradle of Growth | Preserve intrinsic mana abilities and layers. |

**No remaining composition candidates.** Groups 15–17 have migrated their nine eligible consumers; the remaining cards retain other mechanic gates.

## Mechanic groups

### 01. Targeting, captured identities, and death return

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="01"></a>**01 — Mixed targeting and identity-safe actions** | Available | Player/permanent target kinds; typed announcement choices; captured death-return identities. | — | `Waterlogged Teachings // Inundated Archive` |

### 02. Library search and destination composition

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="02"></a>**02 — Typed searches and split destinations** | Available | Search, reveal, select a subset, move to different destinations, and shuffle. Boseiju, Who Endures has migrated. | — | `Finale of Devastation` |

### 03. Cycling

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="03"></a>**03 — Cycling correctness follow-up** | Review | Canonical cycling exists, but #440 activation-time trigger timing and #441 self-cycling from exile still need correction. | — | `Alabaster Host Intercessor` |

### 04. Pay-life entry replacements

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="04"></a>**04 — Optional pay-life entry** | Available | Canonical optional life payment and tapped-entry branching; reuse for pay-3-life lands. | — | None remaining |

### 05. Damage prevention

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="05"></a>**05 — Captured prevention shields** | Available | Prevention capacities, damage follow-ups, source identities, and source-independent shield lifetime. Player life/game-result restrictions are separate in 42. | — | None remaining |

### 06. Amount expressions and actual life/damage results

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="06"></a>**06 — Numeric results and amount composition** | Available | Multiplication, minimum, current/LKI characteristics, captured amounts, actual life-loss/damage totals, and colored X. Mirror Universe and Necrologia have migrated. | — | `Mister Negative`; `Repay in Kind` |

### 07. Action outcomes, captured players, and copy snapshots

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="07"></a>**07 — Object/player captures and outcome follow-ups** | Available | Controller/owner capture, actual move totals, destroyed-object snapshots, per-object follow-ups, persistent copiable snapshots, permanent control distribution, and lasting goad. Boseiju, Who Endures has migrated. | — | `Angel of Sanctions`; `Belonging`; `Desertion`; `Irenicus's Vile Duplication`; `Mirrorweave`; `Nanogene Conversion`; `Quantum Misalignment`; `Ripples of Undeath`; `Sakashima of a Thousand Faces`; `Sin, Spira's Punishment`; `Six`; `Soul of Eternity`; `Spark Double`; `Springheart Nantuko`; `Thespian's Stage`; `Vanish into Memory` |
| <a id="07-mill"></a>**07-mill — Bind cards from a mill action** | Open | Capture resulting identities of the cards milled this way for later optional recovery; retain replacement and zone-change behavior instead of substituting an unrelated inspect/move program. | [07](#07) | `Ripples of Undeath`; `Six` |

### 08. Top-library inspection and selection

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="08"></a>**08 — Bounded inspection, reveal, and remainder movement** | Available | Public/private inspection, dynamic counts, eligible subsets, read-and-continue views, random bottom order, and new battlefield identity capture. The mechanic is available; remaining cards have dependencies elsewhere. | — | `Fact or Fiction`; `Famished Worldsire`; `Fortune's Favor`; `Hostile Negotiations`; `Jace, Multiverse Architect`; `Marina Vendrell`; `Selvala's Stampede`; `Teferi, Who Slows the Sunset` |

### 09. Sacrifice outcomes and entry sacrifice

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="09-count"></a>**09-count — Actual sacrifice counts** | Available | Typed optional choices, numeric `bindCount`, and independent boolean success bindings; count only selected object identities, survive replacement choices/restore, and ignore unrelated sacrifices. Reprocess, Scapeshift, and Victimize have migrated. | — | `Famished Worldsire`; `It That Betrays`; `Pitiless Carnage` |
| <a id="09-devour"></a>**09-devour — Devour as an entry replacement** | Available | Choose eligible permanents and sacrifice as the creature enters; derive entry counters from the actual result. Include land devour, not a later ETB trigger. Famished Worldsire still needs ward. | [09-count](#09-count), [17-counters](#17-counters) | `Famished Worldsire` |

### 10. Mana production

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="10-attached"></a>**10-attached — Attached-land bonus mana** | Available | Mana triggers referring to the enchanted land and its controller; retain chosen-color bindings. | [22-aura](#22-aura), [10-bonus](#10-bonus) | None remaining |
| <a id="10-bonus"></a>**10-bonus — Tapped-for-mana triggers** | Available | Bonus mana keyed to land characteristics, controller, and the mana event; preserve mana-trigger timing. | — | None remaining |
| <a id="10-colors"></a>**10-colors — Available mana types** | Available | Query what own/opponent lands could produce, including colorless where applicable; avoid recursive Reflecting Pool loops. | — | None remaining |
| <a id="10-filter"></a>**10-filter — Hybrid/filter mana payments** | Available | Hybrid activation costs, mixed-color production choices, and planner support. | — | None remaining |
| <a id="10-loss"></a>**10-loss — Mana-loss consequences** | Available | Observe unspent mana being lost and apply the corresponding life loss. | — | None remaining |
| <a id="10-mill"></a>**10-mill — Mill as a cost** | Available | Pay a mill cost atomically before adding mana; reject an unpayable cost. | — | `Dakmor Salvage`; `Life from the Loam` |
| <a id="10-tapped"></a>**10-tapped — Becomes-tapped occurrence** | Available | Trigger on becoming tapped, including tapping for something other than mana. | — | None remaining |

### 11. Timing, conditions, and activation costs

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="11-activation"></a>**11-activation — Activation predicates** | Available | Not-your-turn, graveyard threshold, land-count, and other non-sorcery activation conditions via `when` on activated abilities. Cephalid Coliseum, Ghost Town, Mirror Universe, Temple of the False God, and Blitzball have migrated. | — | None remaining |
| <a id="11-casting"></a>**11-casting — Casting timing restrictions** | Available | Restrict a spell to a particular player/step with `when` on the spell ability; distinguish this from a triggered ability. Necrologia has migrated. | — | None remaining |
| <a id="11-flash"></a>**11-flash — Player casting-timing permissions** | Available | Grant as-though-flash permissions to a player until the stated duration ends. Alchemist's Refuge has migrated. | — | None remaining |
| <a id="11-reduction"></a>**11-reduction — Dynamic activation-cost reductions** | Available | Per-legendary Amount reductions and continuous reductions for activated abilities of filtered objects. Blossoming Tortoise, Boseiju, Who Endures, and Otawara, Soaring City have migrated. | — | None remaining |

### 12. Dredge

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="12-dredge"></a>**12-dredge — Dredge draw replacement** | Open | Optional draw replacement, exact mill cost/library sufficiency, graveyard identity, competing replacements, and restore. | [10-mill](#10-mill) | `Dakmor Salvage`; `Life from the Loam` |

### 13. Turn-step scheduling

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="13-step"></a>**13-step — Native step triggers** | Available | Typed native step occurrences match actual transitions, capture the active player, support player filters and generated grants, and check intervening conditions at capture/resolution. Dark Confidant, Dark Tutelage, Braids, Sygg, and Test of Endurance have migrated. | — | `All-Fates Stalker`; `Awaken the Honored Dead`; `Belonging`; `Coercive Portal`; `Crawling Sensation`; `Ephemerate`; `Hypergenesis`; `Kederekt Leviathan`; `Kiora Bests the Sea God`; `Kuroki, Thief of Talents`; `Portal to Phyrexia`; `Quantum Misalignment`; `Ripples of Undeath`; `Soul of Eternity`; `Starfield of Nyx`; `Summon: Leviathan`; `Summon: Titan`; `Tenuous Truce`; `Wall of Shards` |
| <a id="13-delayed-main"></a>**13-delayed-main — Next main-phase scheduling** | Available | Schedule the next precombat or postcombat main phase of the specified player, whichever occurs first; retain captured amounts after the source leaves. | — | None remaining |
| <a id="13-untap"></a>**13-untap — Other-player untap participation** | Open | Untap a qualifying permanent during other players' untap steps; this is not an ordinary upkeep trigger. | — | `Bender's Waterskin` |
| <a id="13-upkeep"></a>**13-upkeep — Cumulative upkeep** | Open | Age counters, repeated payments, recipient choices, and sacrifice on failure. | [13-step](#13-step) | `Wall of Shards` |

### 14. Amounts and characteristic queries

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="14-add"></a>**14-add — Amount addition** | Available | Add numeric amount expressions without using unsigned stat-delta shortcuts. | — | None remaining |
| <a id="14-counters"></a>**14-counters — Counter-count amounts** | Available | Read named current counter counts for production, doubling, or other numeric effects. Mossborn Hydra has migrated. | — | `Everflowing Chalice` |
| <a id="14-difference"></a>**14-difference — Nonnegative amount difference** | Available | Subtract player/object counts with the correct nonnegative floor for draw/effect counts. Sandstone Oracle has migrated. | — | None remaining |
| <a id="14-filter"></a>**14-filter — Dynamic characteristic filters** | Available | Object filters compare power, toughness, mana value, or loyalty against X and other amounts, including greatest-power ties. Black Sun's Twilight has migrated. | — | `Finale of Devastation`; `Getaway Glamer`; `Rishkar's Expertise`; `Ugin, the Spirit Dragon` |
| <a id="14-greatest"></a>**14-greatest — Greatest characteristic** | Available | Compute/capture maximum power or another characteristic over an object set; use it for pump/draw. Overwhelming Stampede, Pathbreaker Ibex, and Return of the Wildspeaker have migrated. | — | `Rishkar's Expertise` |
| <a id="14-signed-minimum"></a>**14-signed-minimum — Signed player-life minimum** | Open | Compute the lowest actual life total across players, including negative totals. | — | `Repay in Kind` |
| <a id="14-result-max"></a>**14-result-max — Maximum action result** | Open | Compute a maximum over per-player action results such as actual discarded counts; this does not require an object-power query. | — | `Windfall` |

### 15. Predicates and player iteration

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="15-commander"></a>**15-commander — Commander predicates** | Available | Identify a controlled commander for lieutenant and announcement-time conditions. | — | `Will of the Sultai` |
| <a id="15-compare"></a>**15-compare — Quantified player comparisons** | Available | Test whether any relevant opponent has more lands/creatures/hand cards/life; evaluate each player in the right scope. `somePlayerHasLess` is the inverse. Beza and Breena have migrated. | — | None remaining |
| <a id="15-each"></a>**15-each — Per-player instruction iteration** | Available | Run per-player programs in APNAP order with scoped player context, independent local choices/results, typed continuations, and parent-binding restoration. | — | `Coercive Portal`; `Council's Judgment`; `Círdan the Shipwright`; `Erestor of the Council`; `Eureka`; `Hypergenesis`; `Illusion of Choice`; `Portal to Phyrexia`; `Rankle, Master of Pranks`; `Sail into the West`; `Selvala's Stampede`; `Show and Tell`; `Split Decision`; `Trap the Trespassers`; `Windfall` |
| <a id="15-mana"></a>**15-mana — Mana-ability classification filter** | Available | Select cards with intrinsic or canonically classified activated/eligible triggered mana abilities; targets and library movement follow the shared classifier. Moonsilver Key has migrated. | — | None remaining |
| <a id="15-names"></a>**15-names — Distinct and matching names** | Available | Count distinct current names and compare against current/LKI object names across battlefield/graveyard; Field of the Dead and Guardian Project have migrated. | — | `Wedding Ring` |
| <a id="15-player"></a>**15-player — Non-target player choice** | Available | Canonical choosePlayer reuses typed selectPlayers, binds a non-target player set, and preserves its player domain (including an empty set) in generated/delayed programs. | — | `Fact or Fiction`; `Fortune's Favor`; `Hostile Negotiations`; `Incarnation Technique`; `Parting Gust`; `Perch Protection`; `Wall of Shards` |

### 16. Modal faces

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="16-faces"></a>**16-faces — Pay-life MDFC composition** | Available | Reuse the existing modal face handoff and pay-life replacement; migrate every front/back behavior and alias together. Sea Gate Restoration and Sink into Stupor have migrated. | [04](#04) | None remaining |
| <a id="16-hand-limit"></a>**16-hand-limit — Duration-based player hand-size grant** | Available | Grant unlimited hand size for the rest of the game independently of the resolving source. Sea Gate Restoration has migrated. | — | None remaining |
| <a id="16-stack-object"></a>**16-stack-object — Mixed spell/permanent bounce** | Available | Target a spell or a nonland permanent in one clause and return its underlying card to its owner's hand. Sink into Stupor has migrated. | — | None remaining |

### 17. Conditional land entry

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="17-entry"></a>**17-entry — Conditional tapped entry** | Available | Count other lands/land types as entry is determined; preserve actual untapped-entry conditions for triggers. | — | `Hall of Storm Giants`; `Lair of the Hydra` |
| <a id="17-reveal"></a>**17-reveal — Reveal-from-hand entry choice** | Available | Optional hand reveal as an entry replacement, with private choice and public reveal semantics. | — | None remaining |
| <a id="17-counters"></a>**17-counters — Entry counters** | Available | Add counters as a permanent enters, from constants, paid-cost counts, or replacement results; entry observers must see them already present. | — | `Everflowing Chalice`; `Famished Worldsire`; `Spark Double` |

### 18. Linked exile

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="18-duration"></a>**18-duration — Exile until a source leaves** | Available | Link resulting exiled identities to source incarnation; return under owners, including source departure before/after resolution. | — | `Alabaster Host Intercessor`; `All-Fates Stalker`; `Angel of Sanctions`; `Bishop of Binding`; `Glorious Protector`; `Lumbering Battlement` |
| <a id="18-links"></a>**18-links — Persistent linked-card sets** | Open | Retain one/many exiled identities for later activations or linked characteristics, including power, toughness, counts, and colors. | — | `Bishop of Binding`; `Endless Sands`; `Lumbering Battlement`; `Phyrexian Ingester`; `Pit of Offerings`; `Valgavoth, Terror Eater` |
| <a id="18-monarch"></a>**18-monarch — Monarch and linked duration** | Open | Become monarch, observe opponent monarch changes, and end linked exile on that event. | — | `Palace Jailer` |
| <a id="18-triggers"></a>**18-triggers — Independent exile/return triggers** | Available | Link separate ETB/LTB abilities (Fiend Hunter style), preserving their different timing from until-source-leaves. | [18-duration](#18-duration) | None remaining |

### 19. Life totals and game outcomes

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="19-exchange"></a>**19-exchange — Exchange and set life totals** | Available | Exchange as one semantic action, bind actual loss, and handle signed totals and life-change restrictions. Mirror Universe has migrated. | [06](#06) | `Mister Negative`; `Repay in Kind` |
| <a id="19-history"></a>**19-history — Life-loss history** | Available | Query life lost this turn by one player or all players; preserve actual rather than attempted losses. Children of Korlis, Tainted Sigil, and Sygg have migrated. | — | None remaining |
| <a id="19-win"></a>**19-win — Win-game instruction** | Available | Apply a canonical win instruction through game-result restrictions. Test of Endurance has migrated. | — | None remaining |

### 20. Countering and spell eligibility

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="20-counterability"></a>**20-counterability — Uncounterable spells** | Open | Persist and enforce spell counterability, including qualified mana provenance from 23. | — | `Cavern of Souls`; `Delighted Halfling`; `Dovin's Veto`; `Nezahal, Primal Tide` |
| <a id="20-destination"></a>**20-destination — Conditional counter destination** | Open | On successful counter, move the original artifact/creature card to the battlefield instead of the graveyard. | [07](#07) | `Desertion` |
| <a id="20-origin"></a>**20-origin — Cast-origin predicates** | Open | Filter by the zone/owner from which a spell was cast; also used by rebound and other provenance-dependent rules. | — | `All-Fates Stalker`; `Ephemerate`; `Incarnation Technique`; `Pitiless Carnage`; `Quantum Misalignment`; `Vantress Visions`; `Virtue of Knowledge`; `Wash Away`; `Wedding Ring`; `Zanarkand, Ancient Metropolis // Lasting Fayth` |
| <a id="20-payment"></a>**20-payment — Counter unless a player pays** | Available | Resolution-time mana payment by the spell controller, with typed choices and mana opportunities. | — | `Famished Worldsire`; `Hall of Storm Giants`; `Roaming Throne`; `Sire of Seven Deaths`; `Summon: Leviathan`; `Valgavoth, Terror Eater` |
| <a id="20-relationships"></a>**20-relationships — Stack targeting relationships** | Open | Filter spells by the permanents/players they target, and retain target object identities. | — | `Keep Safe` |

### 21. Combat and keywords

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="21-annihilator"></a>**21-annihilator — Annihilator** | Open | Defending-player sacrifice on attack, through ordinary typed sacrifice choices. | [09-count](#09-count), [34-defender](#34-defender) | `It That Betrays` |
| <a id="21-even"></a>**21-even — Even-mana-value restrictions** | Open | Apply parity restrictions to casting and blocking, including mana value zero. | — | `Void Winnower` |
| <a id="21-fear"></a>**21-fear — Fear** | Available | Canonical keyword authoring and artifact-or-black blocker restriction. Profane Command has migrated. | — | None remaining |
| <a id="21-first-strike"></a>**21-first-strike — First strike** | Open | Canonical keyword authoring and first-strike damage steps. | — | `Sire of Seven Deaths` |
| <a id="21-infect"></a>**21-infect — Infect** | Open | Canonical keyword authoring and poison/-1/-1-counter damage results. | — | `Blightsteel Colossus` |
| <a id="21-lifelink"></a>**21-lifelink — Lifelink** | Open | Canonical keyword authoring and actual-damage life gain. | — | `Mister Negative`; `Sire of Seven Deaths`; `Valgavoth, Terror Eater`; `Yarok, the Desecrated` |
| <a id="21-menace"></a>**21-menace — Menace** | Open | Canonical keyword authoring and minimum-blocker requirements. | — | `Kuroki, Thief of Talents`; `Sire of Seven Deaths` |
| <a id="21-reach"></a>**21-reach — Reach** | Available | Canonical keyword authoring and blocking legality. | — | `Ancient Greenwarden`; `Lumra, Bellow of the Woods`; `Sire of Seven Deaths`; `Six`; `Summon: Titan` |
| <a id="21-static"></a>**21-static — Continuous keyword grants** | Available | Filtered static keyword grants, including conditional grants; suppression/cannot-gain is a separate contract. | — | `Concordant Crossroads` |
| <a id="21-suppress"></a>**21-suppress — Keyword suppression and cannot-gain** | Available | Layer-aware removal and cannot-have-or-gain precedence for a keyword. Archetype of Endurance has migrated. | [21-static](#21-static) | None remaining |
| <a id="21-targets"></a>**21-targets — Mandatory targeting requirements** | Open | Flagbearer-style obligations while announcing targets; enforce if-able rules. | — | `Standard Bearer` |
| <a id="21-tax"></a>**21-tax — Attack/block taxes** | Open | Announcement and payment of attack/block taxes, including untapped/attacking source conditions. | — | `Archangel of Tithes`; `Baird, Steward of Argive` |
| <a id="21-ward"></a>**21-ward — Ward** | Open | Opponent targeting occurrence, source/target capture, mana payment, and countering the targeted spell/ability on nonpayment. Separate rows extend the payment kind. | [20-payment](#20-payment) | `Famished Worldsire`; `Hall of Storm Giants`; `Roaming Throne`; `Sire of Seven Deaths`; `Summon: Leviathan`; `Valgavoth, Terror Eater` |
| <a id="21-ward-life"></a>**21-ward-life — Life-payment ward** | Open | Extend ward to mandatory-or-counter life payment; preserve legal life-payment boundaries. | [21-ward](#21-ward) | `Sire of Seven Deaths` |
| <a id="21-ward-sacrifice"></a>**21-ward-sacrifice — Sacrifice-payment ward** | Open | Extend ward to a chosen set of permanents as payment; require the full cost or counter the targeted item. | [21-ward](#21-ward) | `Valgavoth, Terror Eater` |

### 22. Continuous characteristics and attachments

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="22-ability-loss"></a>**22-ability-loss — Ability loss and type/base-stat changes** | Open | Layer-correct ability removal, subtype additions, and base P/T setting without deleting unrelated characteristics. | — | `Curious Colossus` |
| <a id="22-aura"></a>**22-aura — Typed Aura spell attachment** | Available | Typed enchant selectors, targeted Aura spell entry with attachment identity, legality checks, host references, and chosen-color entry composition. Broader noncast entry/equipment/attachment continuous effects remain in 22-attachment. | — | None remaining |
| <a id="22-attachment"></a>**22-attachment — Attachment references and Aura rules** | Open | Enchant restrictions, attached object/player references, and attachment-dependent continuous effects. | — | `Colossification`; `Springheart Nantuko`; `Tenuous Truce` |
| <a id="22-changeling"></a>**22-changeling — All creature types** | Open | Changeling and all-creature-types effects in every applicable zone; preserve type unions and exclusions. | — | `Belonging`; `Firdoch Core`; `Masked Vandal`; `Maskwood Nexus` |
| <a id="22-characteristics"></a>**22-characteristics — Continuous characteristic definitions** | Open | CDA power/toughness from a live amount, conditional animation/base stats, and continuous type/stat updates. | — | `Lumra, Bellow of the Woods`; `Soul of Eternity`; `Starfield of Nyx` |
| <a id="22-choose-type"></a>**22-choose-type — Choose a creature type** | Open | Persist a non-target creature-type choice and use it in subsequent filters and continuous effects. | — | `Cavern of Souls`; `Kindred Dominance`; `Raise the Palisade`; `Roaming Throne` |
| <a id="22-grants"></a>**22-grants — Grant activated ability programs** | Open | Grant canonical activated abilities with independent lexical/source bindings and duration; existing generated grants cover triggered abilities. | — | `Rain of Filth` |
| <a id="22-land-types"></a>**22-land-types — Land-type overlays** | Open | Layer-aware addition of basic land types and the intrinsic mana abilities they confer. | — | `Blanket of Night`; `Urborg, Tomb of Yawgmoth`; `Yavimaya, Cradle of Growth` |
| <a id="22-types"></a>**22-types — Additive type/subtype changes** | Open | Add a subtype to a returned/current permanent without replacing its existing types or making a copy. | — | `Portal to Phyrexia` |

### 23. Mana provenance

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="23-mana"></a>**23-mana — Restricted mana and counterability** | Open | Typed spending restrictions, producer provenance, and qualifying-spell uncounterability. | [20-counterability](#20-counterability) | `Cavern of Souls`; `Delighted Halfling` |

### 24. Animation and crew

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="24-animation"></a>**24-animation — Temporary animation** | Open | Temporary type/subtype/base P/T changes while retaining the permanent's other specified characteristics. | — | `Firdoch Core`; `Hall of Storm Giants`; `Hedge Shredder`; `Lair of the Hydra` |
| <a id="24-crew"></a>**24-crew — Crew costs** | Open | Tap a selected creature set with sufficient total power as a cost; animate the Vehicle. | [24-animation](#24-animation) | `Hedge Shredder` |

### 25. Casting costs and alternate casting

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="25-alternative"></a>**25-alternative — Conditional alternative life payment** | Open | Conditionally replace a mana cost with life; keep life payment distinct from damage. | — | `Snuff Out` |
| <a id="25-cleave"></a>**25-cleave — Cleave** | Open | Alternate cost changes the spell's restrictions/target program. | [20-origin](#20-origin) | `Wash Away` |
| <a id="25-convoke"></a>**25-convoke — Convoke** | Open | Creature tapping as mana contribution, preserving color and summoning-sickness rules. | — | `Pile On` |
| <a id="25-delve"></a>**25-delve — Delve** | Available | Exile chosen graveyard cards during payment to cover generic mana only; preserve colored requirements, reductions, and restore. | — | None remaining |
| <a id="25-embalm"></a>**25-embalm — Embalm** | Open | Graveyard exile cost and modified white Zombie token copy with no mana cost. | [28-modifiers](#28-modifiers) | `Angel of Sanctions` |
| <a id="25-escape"></a>**25-escape — Escape** | Open | Graveyard casting with mana plus exile-other-cards costs. | [26-graveyard-spells](#26-graveyard-spells) | `Cling to Dust` |
| <a id="25-evidence"></a>**25-evidence — Collect evidence** | Open | Select graveyard cards whose total mana value meets the cost; retain paid status. | — | `Analyze the Pollen` |
| <a id="25-evoke"></a>**25-evoke — Evoke** | Open | Alternate casting plus an entry sacrifice trigger tied to the paid casting option. | — | `Mulldrifter` |
| <a id="25-flashback"></a>**25-flashback — Flashback** | Open | Cast from graveyard with alternate costs and the correct exile replacement. | [26-graveyard-spells](#26-graveyard-spells) | `Dread Return` |
| <a id="25-foretell"></a>**25-foretell — Foretell** | Open | Private face-down exile, later-turn casting permission, and foretell cost. | [26-exile-play](#26-exile-play) | `Glorious Protector` |
| <a id="25-gift"></a>**25-gift — Gift** | Open | Promise a gift at announcement; choose the recipient and apply the gift before the remaining effects. | [15-player](#15-player) | `Parting Gust`; `Perch Protection` |
| <a id="25-kicker"></a>**25-kicker — Kicker** | Open | Persist a paid kicker option for targeting and resolution branches; repeatable multikicker is a separate extension. | — | `Everflowing Chalice`; `Joint Exploration`; `Tear Asunder` |
| <a id="25-modal"></a>**25-modal — Conditional mode counts** | Open | Announcement-time conditions change how many modes may be chosen. | [15-commander](#15-commander) | `Will of the Sultai` |
| <a id="25-plot"></a>**25-plot — Plot** | Open | Special-action exile from hand and later-turn sorcery casting permission without paying mana. | [26-exile-play](#26-exile-play), [20-origin](#20-origin) | `Pitiless Carnage` |
| <a id="25-reductions"></a>**25-reductions — Conditional spell-cost reductions** | Open | Apply reductions from graveyard card-type diversity, target characteristics, or opponent basics. | — | `Drag to the Roots`; `Hagra Mauling // Hagra Broodpit`; `Price of Fame` |
| <a id="25-spree"></a>**25-spree — Spree** | Open | Choose one or more paid modes and preserve mode-dependent costs/targets. | — | `Getaway Glamer` |
| <a id="25-suspend"></a>**25-suspend — Suspend** | Open | Time counters, upkeep removal, no-mana-cost casting, and resulting haste. | [13-step](#13-step), [26-exile-play](#26-exile-play) | `Hypergenesis` |
| <a id="25-warp"></a>**25-warp — Warp** | Open | Alternate hand casting, delayed exile, and later-turn casting from that exile. | [26-exile-play](#26-exile-play), [20-origin](#20-origin), [13-step](#13-step) | `All-Fates Stalker` |
| <a id="25-multikicker"></a>**25-multikicker — Multikicker** | Open | Allow repeated kicker payment and retain the paid count for entry effects. | [25-kicker](#25-kicker) | `Everflowing Chalice` |

### 26. Zone play permissions

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="26-exile"></a>**26-exile — Replacement-linked exile permission** | Open | Track cards exiled by a specific replacement and permit their play with an alternate life cost. | [26-exile-play](#26-exile-play), [18-links](#18-links) | `Valgavoth, Terror Eater` |
| <a id="26-exile-play"></a>**26-exile-play — Play/cast from authorized exile** | Open | Apply exile identity, later-turn/duration, face, timing, cost-policy, and land/spell permissions. | [26-permission](#26-permission) | `All-Fates Stalker`; `Ephemerate`; `Glorious Protector`; `Hypergenesis`; `Pitiless Carnage`; `Quantum Misalignment`; `Valgavoth, Terror Eater` |
| <a id="26-graveyard-lands"></a>**26-graveyard-lands — Land play from graveyard** | Open | Allow land plays from the authorized player's graveyard through ordinary land-play legality and limits. | [26-permission](#26-permission) | `Ancient Greenwarden`; `Forgotten Cellar`; `Icetill Explorer`; `Mole Man, Moloid Master`; `Walk-In Closet` |
| <a id="26-graveyard-replacement"></a>**26-graveyard-replacement — Temporary graveyard-to-exile replacement** | Open | A scoped replacement sends cards that would enter the player's graveyard to exile for the remainder of the turn. | — | `Forgotten Cellar`; `Walk-In Closet` |
| <a id="26-graveyard-spells"></a>**26-graveyard-spells — Spell casting from graveyard** | Open | Authorize canonical spell announcement from graveyard, keeping normal/alternate/additional costs and resulting-zone policies. | [26-permission](#26-permission) | `Cling to Dust`; `Dread Return`; `Forgotten Cellar`; `Six`; `Walk-In Closet` |
| <a id="26-hand"></a>**26-hand — Cast from an offered hand** | Open | Optional/free casting during resolution from a private hand, with full announcement and continuation. | [26-permission](#26-permission) | `Kuroki, Thief of Talents`; `Rishkar's Expertise` |
| <a id="26-library-lands"></a>**26-library-lands — Land play from library top** | Open | Authorize only the actual top land, preserve play limits and timing, and re-evaluate the top after each move. | [26-permission](#26-permission), [26-top](#26-top) | `Courser of Kruphix` |
| <a id="26-permission"></a>**26-permission — Zone-permission infrastructure** | Open | Typed permission records scoped by source/duration, player, zone, card kind, and cost policy; integrate canonical announcement without hardcoded card names. | — | `All-Fates Stalker`; `Ancient Greenwarden`; `Cling to Dust`; `Courser of Kruphix`; `Dread Return`; `Ephemerate`; `Forgotten Cellar`; `Glorious Protector`; `Hypergenesis`; `Icetill Explorer`; `Kederekt Leviathan`; `Kuroki, Thief of Talents`; `Mole Man, Moloid Master`; `Pitiless Carnage`; `Quantum Misalignment`; `Rishkar's Expertise`; `Six`; `Valgavoth, Terror Eater`; `Vantress Visions`; `Virtue of Knowledge`; `Walk-In Closet`; `Zanarkand, Ancient Metropolis // Lasting Fayth` |
| <a id="26-retrace"></a>**26-retrace — Retrace** | Open | Grant permanent spells in graveyard an additional land-discard cost during the right player's turn. | [26-graveyard-spells](#26-graveyard-spells) | `Six` |
| <a id="26-top"></a>**26-top — Public top-card visibility** | Open | Continuously expose the actual top library card to all seats, including changes during multi-card actions. | — | `Courser of Kruphix` |

### 27. Multi-player hand placement

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="27-place"></a>**27-place — APNAP optional hand placement** | Open | Each player chooses a qualifying card, then process the placement with correct visibility and trigger checkpoints. | [15-each](#15-each) | `Eureka`; `Hypergenesis`; `Show and Tell` |
| <a id="27-repeat"></a>**27-repeat — Repeat placement rounds** | Open | Continue until an entire round declines; keep per-player continuation state. | [27-place](#27-place) | `Eureka`; `Hypergenesis` |

### 28. Copy and control effects

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="28-demonstrate"></a>**28-demonstrate — Demonstrate** | Open | Optional spell copy plus an opponent's copy during the cast trigger, with separate controllers/targets. | [15-player](#15-player), [20-origin](#20-origin) | `Incarnation Technique` |
| <a id="28-entry"></a>**28-entry — Copy as an entry replacement** | Open | Optional clone-as-entry with extra counters or retained abilities. | [28-modifiers](#28-modifiers) | `Sakashima of a Thousand Faces`; `Spark Double` |
| <a id="28-exchange"></a>**28-exchange — Temporary control exchange** | Open | Exchange captured permanent sets, grant haste, and expire independently of source lifetime. Dack's permanent control distribution is already available. | — | `Reins of Power` |
| <a id="28-legend"></a>**28-legend — Legend-rule exceptions and deck keywords** | Open | Continuous legend-rule exemption and any required commander/deck-construction keyword representation; verify full printed behavior. | — | `Sakashima of a Thousand Faces` |
| <a id="28-modifiers"></a>**28-modifiers — Copy exceptions** | Open | Nonlegendary copies, added/retained abilities and types, colors, and removed mana costs; preserve copiable values. | [07](#07) | `Angel of Sanctions`; `Belonging`; `Irenicus's Vile Duplication`; `Mirrorweave`; `Nanogene Conversion`; `Quantum Misalignment`; `Sakashima of a Thousand Faces`; `Soul of Eternity`; `Spark Double`; `Thespian's Stage` |
| <a id="28-rebound"></a>**28-rebound — Rebound** | Open | Hand-cast provenance, resolving exile, and optional free cast at the next upkeep. | [20-origin](#20-origin), [13-step](#13-step), [26-exile-play](#26-exile-play) | `Ephemerate`; `Quantum Misalignment` |
| <a id="28-temporary"></a>**28-temporary — Temporary copy effects** | Open | Copy onto existing permanents for a duration and correctly restore/re-layer characteristics. | [28-modifiers](#28-modifiers) | `Mirrorweave`; `Nanogene Conversion`; `Thespian's Stage` |

### 29. Ability copies and trigger multiplication

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="29-activation"></a>**29-activation — Ability activation occurrence** | Open | Observe an activated ability being activated, including paid optional copy triggers. | [29-copy](#29-copy) | `Rings of Brighthearth` |
| <a id="29-copy"></a>**29-copy — Copy a stack ability** | Open | Copy activated/triggered abilities with retargeting; exclude mana abilities where specified. | — | `Rings of Brighthearth`; `Vantress Visions`; `Virtue of Knowledge` |
| <a id="29-multiply"></a>**29-multiply — Trigger multiplication** | Open | Duplicate qualifying triggers from entering objects or chosen creature types without multiplying the underlying event. | — | `Ancient Greenwarden`; `Roaming Throne`; `Vantress Visions`; `Virtue of Knowledge`; `Yarok, the Desecrated` |

### 30. Alternative return mechanics

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="30-persist"></a>**30-persist — Persist** | Open | Dies trigger with last-known counters; return the correct graveyard identity with a -1/-1 counter. | — | `Woodfall Primus` |
| <a id="30-return-result"></a>**30-return-result — Return-success-dependent follow-up** | Open | Capture returned identities/current toughness and branch on actual return success after replacement. | [07](#07) | `Vanish into Memory` |
| <a id="30-unearth"></a>**30-unearth — Unearth** | Open | Graveyard activation, haste, end-step exile, and leave-battlefield exile replacement. | [13-step](#13-step), [26-permission](#26-permission) | `Kederekt Leviathan` |

### 31. Relational searches

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="31-flash"></a>**31-flash — Ability predicates for library selection** | Open | Filter for cards with flash and other rule-granted ability predicates, not only Oracle text. | — | `Waterlogged Teachings // Inundated Archive` |
| <a id="31-multizone"></a>**31-multizone — Multi-zone search** | Open | Search library and/or graveyard as one optional program; shuffle only when the library was searched. | [02](#02) | `Finale of Devastation` |
| <a id="31-related"></a>**31-related — Relationships between selected cards** | Open | Selected basics must share a land type; preserve reveal, fail-to-find, and shuffle semantics. | — | `Myriad Landscape` |

### 32. Loyalty and emblems

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="32-emblems"></a>**32-emblems — Emblems** | Open | Source-independent command-zone programs with ongoing abilities. | [32-loyalty](#32-loyalty) | `Teferi, Who Slows the Sunset` |
| <a id="32-loyalty"></a>**32-loyalty — Loyalty activation** | Open | Loyalty costs including X, once-per-turn use, timing, and full announcement validation. | — | `Jace, Multiverse Architect`; `Teferi, Who Slows the Sunset`; `Ugin, the Spirit Dragon` |

### 33. Simultaneous discard/draw

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="33-discard"></a>**33-discard — Actual per-player discard totals** | Open | Discard hands with correct shared checkpoints; retain each player's actual count and compute their maximum. | [15-each](#15-each), [14-result-max](#14-result-max) | `Windfall` |

### 34. Damage and combat occurrences

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="34-damage"></a>**34-damage — Damage/enrage occurrences** | Available | `dealtDamage` occurrences bind recipient, source, amount, and optional combat. Apex Altisaur and Souls of the Faultless have migrated. | — | `Rankle, Master of Pranks` |
| <a id="34-defender"></a>**34-defender — Defending-player bindings** | Available | Attack occurrences capture `triggering.defender`; `playerAttacks` fires once per defending player. Breena, Kogla, and Souls of the Faultless have migrated. | — | `Belonging`; `It That Betrays`; `Soul of Eternity`; `Tenuous Truce` |
| <a id="34-history"></a>**34-history — Source-attributed damage history** | Available | `damageDealtThisTurn` reads the object ledger; `combatDamageThisTurn` reads legendary combat-to-player history. Blitzball and Grothama have migrated. | [34-damage](#34-damage) | None remaining |

### 35. Event history and grouped occurrences

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="35-group"></a>**35-group — Grouped zone-change occurrences** | Open | One-or-more library/graveyard moves as one occurrence, with captured moved identities. | — | `Crawling Sensation`; `Hedge Shredder`; `It That Betrays` |
| <a id="35-life"></a>**35-life — Life-gain occurrences** | Open | Capture player and actual gain amount, with turn/relationship filters. | — | `Niv-Mizzet, Ghost Counsel`; `Wedding Ring` |
| <a id="35-ordinal"></a>**35-ordinal — Per-turn event ordinals** | Open | First/second cast, draw, or grouped zone-change event; keep scope and reset rules explicit. | — | `Crawling Sensation`; `Lotho, Corrupt Shirriff`; `Zimone and Dina` |
| <a id="35-provenance"></a>**35-provenance — Was-cast and turn provenance** | Open | Distinguish a cast permanent from other entries and filter ongoing programs by the relevant player's turn. | [20-origin](#20-origin) | `Wedding Ring` |
| <a id="35-repeat"></a>**35-repeat — Conditionally repeat a program once** | Open | Repeat draw/hand-placement instructions once at resolution after checking the current condition; preserve choices. | — | `Zimone and Dina` |
| <a id="35-token"></a>**35-token — Token creation/sacrifice occurrences** | Open | Observe actual creation/sacrifice of tokens and preserve the required trigger cardinality. | — | `Mirkwood Bats` |

### 36. Optional exile on resolution

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="36-exile"></a>**36-exile — Optional resolution exile with success binding** | Open | Choose a graveyard card after target announcement, exile it on resolution, and condition the effect on actual success. | — | `Masked Vandal` |

### 37. Player sacrifice and modal triggers

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="37-modes"></a>**37-modes — Any-number triggered modes** | Open | Choose any allowed subset of modes when putting a triggered ability on the stack, including zero where printed. | — | `Rankle, Master of Pranks` |
| <a id="37-sacrifice"></a>**37-sacrifice — Per-player sacrifice requests** | Open | Ask each affected player to choose the required permanents, choosing all available when insufficient. | [15-each](#15-each) | `Portal to Phyrexia`; `Rankle, Master of Pranks` |

### 38. Random object choice and repetition

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="38-random"></a>**38-random — Random identity-bound object selection** | Open | Persist authoritative randomness and bind the chosen graveyard identity for copying/conditional repetition. | [07](#07) | `Sin, Spira's Punishment` |
| <a id="38-tapped"></a>**38-tapped — Tapped copy tokens** | Open | Create a copiable token snapshot already tapped, before entry triggers observe it. | [07](#07) | `Sin, Spira's Punishment` |
| <a id="38-repeat"></a>**38-repeat — Repeat while the result qualifies** | Open | Repeat a program while its latest result satisfies a predicate; handle an exhausted input set and persist each random result. This differs from Zimone's repeat-once rule. | — | `Sin, Spira's Punishment` |
| <a id="38-token-refs"></a>**38-token-refs — Created-token identity bindings** | Open | Bind newly created token identities for subsequent instructions, including counters placed after creation; do not pick all similar tokens by name. | — | `Zanarkand, Ancient Metropolis // Lasting Fayth` |

### 39. Piles and voting

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="39-control"></a>**39-control — Control or modify votes** | Open | Apply vote-controller/extra-vote effects with their own duration and player scope. | [39-vote](#39-vote) | `Illusion of Choice` |
| <a id="39-finished"></a>**39-finished — Finished-voting occurrence** | Open | Expose recorded per-player ballots when a vote finishes so triggered programs can compare choices and count opponents. | [39-vote](#39-vote) | `Erestor of the Council` |
| <a id="39-hidden"></a>**39-hidden — Face-down pile visibility** | Open | Per-seat knowledge of face-up/face-down piles through choices and restore; do not leak concealed identities. | [39-piles](#39-piles) | `Fortune's Favor`; `Hostile Negotiations` |
| <a id="39-object"></a>**39-object — Object ballots** | Open | Vote for eligible object identities, then aggregate votes per object; combine with secret visibility when printed. | [39-vote](#39-vote) | `Trap the Trespassers` |
| <a id="39-piles"></a>**39-piles — Pile division and opponent choices** | Open | Typed pile partition, opponent selection, choosing a pile, and identity-bound result routing. | [08](#08), [15-player](#15-player) | `Fact or Fiction`; `Fortune's Favor`; `Hostile Negotiations` |
| <a id="39-secret"></a>**39-secret — Secret council** | Open | Private votes until reveal, per-player results, ties, and restore. | [39-vote](#39-vote) | `Círdan the Shipwright`; `Trap the Trespassers` |
| <a id="39-vote"></a>**39-vote — Public voting** | Open | Typed sequential public votes, player choices, recorded ballots, totals/ties, and result-dependent continuation. | [15-each](#15-each) | `Coercive Portal`; `Council's Judgment`; `Círdan the Shipwright`; `Erestor of the Council`; `Illusion of Choice`; `Sail into the West`; `Selvala's Stampede`; `Split Decision`; `Trap the Trespassers` |

### 40. Sagas

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="40-saga"></a>**40-saga — Lore and chapter scheduling** | Open | Entry/precombat-main lore counters, chapter triggers, and sacrifice after the final chapter. | [13-step](#13-step) | `Awaken the Honored Dead`; `Kiora Bests the Sea God`; `Summon: Leviathan`; `Summon: Titan` |
| <a id="40-skip"></a>**40-skip — Skip the next untap** | Open | Duration-bound restrictions that consume the correct next untap event. | — | `Kiora Bests the Sea God` |

### 41. Encore and bestow

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="41-bestow"></a>**41-bestow — Bestow** | Open | Alternate Aura casting and attachment/creature transitions; keep attached-copy landfall branching. | [22-attachment](#22-attachment) | `Springheart Nantuko` |
| <a id="41-encore"></a>**41-encore — Encore** | Open | Graveyard exile cost; copy per opponent, haste, required defender, and end-step sacrifice. | [28-modifiers](#28-modifiers), [34-defender](#34-defender), [13-step](#13-step) | `Belonging`; `Soul of Eternity` |

### 42. Replacement, player restrictions, and protection

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="42-conditional"></a>**42-conditional — Conditional draw/life replacement** | Open | Evaluate hand/life thresholds at each individual replaced event, including competing replacements. | — | `Phial of Galadriel` |
| <a id="42-player"></a>**42-player — Player life, targeting, and game-result restrictions** | Open | Player hexproof/protection, cannot-lose/change-life, and cannot-win/lose-game with explicit durations. | — | `Everybody Lives!`; `Perch Protection` |
| <a id="42-regeneration"></a>**42-regeneration — Cannot-regenerate destruction** | Open | Express and enforce a no-regeneration destruction constraint; check the engine's regeneration support before migration. | — | `Snuff Out` |
| <a id="42-shuffle"></a>**42-shuffle — Reveal-and-shuffle graveyard replacement** | Open | Replace a graveyard move with reveal and shuffle of the specific card, including from nonbattlefield zones. | — | `Blightsteel Colossus`; `Darksteel Colossus` |
| <a id="42-turn"></a>**42-turn — Extra turns** | Open | Schedule the gift recipient's extra turn in the correct order. | [25-gift](#25-gift) | `Perch Protection` |
| <a id="42-world"></a>**42-world — World rule** | Open | State-based world-supertype uniqueness, preserving how long each permanent has had the supertype and handling ties. | — | `Concordant Crossroads` |

### 43. Rooms and Adventures

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="43-adventure"></a>**43-adventure — Adventure faces and permission** | Open | Resolve the Adventure face into the correct exile permission, then allow the permanent face. | [26-permission](#26-permission), [20-origin](#20-origin) | `Vantress Visions`; `Virtue of Knowledge`; `Zanarkand, Ancient Metropolis // Lasting Fayth` |
| <a id="43-room"></a>**43-room — Room doors** | Open | Both door programs, casting/lock/unlock costs, sorcery timing, and unlock occurrences. | — | `Forgotten Cellar`; `Marina Vendrell`; `Walk-In Closet` |

### 44. Retired package bucket

No new mechanic lives in this former package bucket. See Incarnation Technique, Kuroki, Thief of Talents, and Nezahal, Primal Tide in the [card dependency list](CARD-MIGRATION-DEPENDENCIES.md).

## Maintenance and validation

Keep mechanic IDs stable. When splitting a contract, add narrower IDs and update every affected card and prerequisite edge. Do not mark a parent contract available after implementing only one variant. Move a migrated card out of the dependency list only after removing its legacy registration; aliases remain separate rows until all exact keys are removed.

Before committing a plan update, verify that:

- Every remaining coverage-ledger `cardRegistrations[].card` appears exactly once in the card dependency table, with no unknown or missing registration keys.
- Every referenced mechanic exists, every prerequisite graph is acyclic, and the reverse dependent lists include transitive requirements.
- Card readiness is derived from **all** prerequisite statuses; source-review flags remain explicit. Same-physical-card aliases reference the full shared program.
- Counts reflect exact legacy keys and mechanic entries, not a percentage of implementation effort.

When implementing, continue the canonical authoring ratchet and test-ownership rules. Preserve open correctness reports separately from migration progress.
