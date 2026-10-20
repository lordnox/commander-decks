# Remaining card-rule migration batches

Snapshot: PR #432, after Cultivate / Kodama’s Reach. Continues #394 and #383. This is a planning inventory, not a claim of complete behavior coverage.

**248 legacy registration keys, assigned exactly once to 43 primary groups.** A group is an implementation family, not necessarily identical Oracle text or one commit. Secondary dependencies are recorded with the group instead of counting the registration again. Some keys name the same physical card or different faces: for example Fell the Profane, Malakir Rebirth, Virtue of Knowledge/Vantress Visions, and Walk-In Closet/Forgotten Cellar. Therefore 248 is not a distinct-card count.

Inventory sources: [`cardRules.ts`](../src/cardPlugins/cardRules.ts), the generated [`rule-dsl-coverage-ledger.json`](rule-dsl-coverage-ledger.json), cached `cards/*.json`, and the current canonical [`schema`](../src/cardPlugins/dsl/schema/v1.ts), builders, and runtime. Cached Oracle text is a planning aid; verify complete current Oracle text and relevant rulings before implementation. Legacy handler contents alone are not the behavioral specification. No live Oracle audit or new gameplay defect investigation was performed for this document.

## Closest matches to batch first

| Shared rule | Registrations | Important difference / extra gate |
| --- | --- | --- |
| Optional pay 2 life or enter tapped | Breeding Pool; Godless Shrine; Hallowed Fountain; Overgrown Tomb; Watery Grave | Printed land types and mana colors vary. |
| Cycling lands | Raffine’s Tower; Zagoth Triome; Secluded Steppe | First two cycle for {3}; Steppe for {W}. All must emit cycling, not merely discard. |
| Reveal top card into hand, lose its mana value | Dark Confidant; Dark Tutelage | Same upkeep program; source card types differ. |
| Prevent all combat damage this turn | Darkness; Kami of False Hope | Same resolving effect; spell versus sacrifice activation. |
| Opponent-land color production | Exotic Orchard; Fellwar Stone | Same available-color query; permanent types differ. |
| All lands gain Swamp type | Blanket of Night; Urborg, Tomb of Yawgmoth | Same overlay; Yavimaya is the Forest variant. |
| Greatest-power team pump with trample | Overwhelming Stampede; Pathbreaker Ibex | Spell versus attack trigger; capture greatest power at the correct time. |
| Opponent drain, gain actual life lost | Exsanguinate; Debt to the Deathless | X versus twice X. |
| Token copy is not legendary | Irenicus’s Vile Duplication; Quantum Misalignment | Irenicus adds flying; Quantum has rebound. |
| Dredge | Dakmor Salvage; Life from the Loam | Dredge 2 versus 3; each also has its ordinary land/spell program. |

## Priorities and effort

**A** means a recommended early reusable slice or a high-reuse dependency, not that every card in the row is ready. **B** follows prerequisite work. **C** is a larger package to defer until shared infrastructure exists. **S/M/L** are relative implementation effort for the family: composition, one focused mechanic, or multiple interacting mechanics. They are not time estimates and should not be summed. Large groups must be split into coherent commits.

Recommended opening sequence: pay-life land entry; cycling lands; native upkeep scheduling plus the Confidant/Tutelage pair; unlimited combat prevention plus Darkness/Kami; controller capture plus Swords/Condemn/counter-token follow-ups. Small existing-primitive candidates can be taken between these batches after full-card review.

## Complete primary assignment

Each numbered group below owns its listed registration keys. Cross-references in the notes do not add to its count.

### 01. Direct targeted effects

Priority **A** · effort **S** · **4 registrations**

**Registrations:** `Lightning Bolt`; `Loran of the Third Path`; `Malakir Rebirth`; `Malakir Rebirth // Malakir Mire`.

**Shared work:** Damage; optional artifact/enchantment destruction; draw; temporary death-return grants.

**Required support / secondary gates:** Check complete face handling for Malakir Rebirth and occurrence identity for the granted return. These are existing-primitive candidates, not certified ready cards.

### 03. Cycling and cycling triggers

Priority **A** · effort **M** · **4 registrations**

**Registrations:** `Astral Drift`; `Raffine's Tower`; `Secluded Steppe`; `Zagoth Triome`.

**Shared work:** Tapped entry, printed mana production, hand activation that discards itself and draws. Raffine’s Tower and Zagoth Triome both cycle for {3}; Secluded Steppe cycles for {W}.

**Required support / secondary gates:** Canonical cycling cost/event semantics, including cycling-trigger interoperability. Ordinary discard plus draw alone is insufficient; Secluded Steppe needs its printed cycling behavior checked against the legacy registration. Astral Drift is a follow-up consumer: add its cycle occurrence and delayed blink before removing its registration.

### 04. Pay-life land entry

Priority **A** · effort **M** · **5 registrations**

**Registrations:** `Breeding Pool`; `Godless Shrine`; `Hallowed Fountain`; `Overgrown Tomb`; `Watery Grave`.

**Shared work:** Breeding Pool, Godless Shrine, Hallowed Fountain, Overgrown Tomb, and Watery Grave share the same optional pay-2-life entry replacement.

**Required support / secondary gates:** Reusable entry-time payment choice with tapped fallback; preserve intrinsic basic-land-type mana abilities and entry trigger snapshots.

### 05. Combat-damage prevention

Priority **A** · effort **L** · **8 registrations**

**Registrations:** `Batwing Brume`; `Comeuppance`; `Darkness`; `Energy Arc`; `Inkshield`; `Kami of False Hope`; `Lady Evangela`; `Sokrates, Athenian Teacher`.

**Shared work:** Unlimited prevention for the turn with combat/source/recipient filters. Darkness and Kami of False Hope have the same resolving prevention effect.

**Required support / secondary gates:** Add true unlimited capacity and combat filtering while honoring unpreventable damage. Then source-only Lady Evangela, bidirectional Energy Arc, prevented-damage results for Inkshield/Comeuppance/Sokrates, and spent-color conditions for Batwing Brume.

### 06. Drain spells

Priority **A** · effort **M** · **3 registrations**

**Registrations:** `Debt to the Deathless`; `Drain Life`; `Exsanguinate`.

**Shared work:** Exsanguinate and Debt to the Deathless drain all opponents and gain the life actually lost.

**Required support / secondary gates:** Numeric multiplication plus actual life-loss result totals, not X times opponent count. Drain Life additionally needs actual damage, capped gain, any-target selection, and black-only X payment; stage it after the first two.

### 07. Object/stack controller follow-up

Priority **A** · effort **M** · **7 registrations**

**Registrations:** `An Offer You Can't Refuse`; `Condemn`; `Fractured Identity`; `Settle the Wreckage`; `Swan Song`; `Swords to Plowshares`; `Terastodon`.

**Shared work:** Target an object or spell, then perform a follow-up for its captured controller.

**Required support / secondary gates:** Reusable controller/owner reference and capture before zone change; power/toughness capture; actual counter/move/destroy outcomes. Token copies, per-player iteration, counted basic searches, and Terastodon multi-target outcome attribution are later dependencies.

### 08. Top-of-library selection

Priority **A** · effort **L** · **9 registrations**

**Registrations:** `Animist's Awakening`; `Dack Fayden, Helping Hand`; `Dig Through Time`; `Famished Worldsire`; `Hostile Negotiations`; `Malevolent Rumble`; `Planar Genesis`; `Satyr Wayfinder`; `Silverback Elder`.

**Shared work:** Look/reveal a bounded top segment, select cards, move the remainder to a specified destination.

**Required support / secondary gates:** Reusable scoped looked-at/revealed sets, subset choices and remainder ordering/randomization. Satyr Wayfinder/Malevolent Rumble are a close sub-batch; Planar Genesis/Silverback Elder share tapped-land selection. Other gates: delve, devour, face-down piles, spell mastery.

### 09. Any-number sacrifice results

Priority **A** · effort **M** · **4 registrations**

**Registrations:** `Pitiless Carnage`; `Reprocess`; `Scapeshift`; `Victimize`.

**Shared work:** Choose and sacrifice permanents, then use the actual sacrifice result for draw/search or conditional return.

**Required support / secondary gates:** Reusable numeric sacrificed-count result and success condition. Reprocess/Scapeshift first; Pitiless Carnage also needs plot; Victimize has two announcement targets and a resolution sacrifice.

### 10. Mana production families

Priority **A** · effort **L** · **18 registrations**

**Registrations:** `Bender's Waterskin`; `Bubbling Muck`; `City of Brass`; `Crypt Ghast`; `Everflowing Chalice`; `Exotic Orchard`; `Fellwar Stone`; `Flooded Grove`; `Horizon of Progress`; `Millikin`; `Nirkana Revenant`; `Rain of Filth`; `Reflecting Pool`; `Talon Gates of Madara`; `Temple of the False God`; `Utopia Sprawl`; `Wild Growth`; `Yurlok of Scorch Thrash`.

**Shared work:** Mana triggers, dynamic available-color queries, conditional activation and special costs.

**Required support / secondary gates:** Exotic Orchard/Fellwar Stone share opponent-land color availability; Reflecting Pool/Horizon use own-land availability. Bubbling Muck/Crypt Ghast/Nirkana share Swamp bonus mana; Wild Growth/Utopia Sprawl share attached-land mana triggers. Flooded Grove needs mixed-pool choice/planner support; Millikin needs mill as a cost; Temple needs an activation condition; Yurlok also needs mana-loss life loss. City of Brass needs a becomes-tapped occurrence, Everflowing Chalice multikicker/entry counters, and Talon Gates an ETB phase-out plus hand activation; those remain secondary gates.

### 11. Timing and activation conditions

Priority **A** · effort **M** · **7 registrations**

**Registrations:** `Alchemist's Refuge`; `Blitzball`; `Boseiju, Who Endures`; `Cephalid Coliseum`; `Ghost Town`; `Necrologia`; `Otawara, Soaring City`.

**Shared work:** Restrict activation/casting timing or grant flash permissions.

**Required support / secondary gates:** Ghost Town: not-your-turn; Cephalid Coliseum: threshold and mana damage; Necrologia: own end step; Blitzball: combat-history condition; Alchemist’s Refuge: until-cleanup casting permission. Costs and draw/move primitives already exist. Boseiju/Otawara form their own channel sub-batch: hand discard costs plus per-legendary activation reductions; Boseiju additionally needs target-controller search.

### 12. Dredge replacement

Priority **A** · effort **M** · **2 registrations**

**Registrations:** `Dakmor Salvage`; `Life from the Loam`.

**Shared work:** Optional draw replacement with an exact mill cost and self-return from graveyard.

**Required support / secondary gates:** Reusable dredge choice integrated with competing draw replacements, library sufficiency, and restore. Dakmor Salvage also uses tapped entry/mana; Life from the Loam uses up-to-three land targets.

### 13. Native step triggers

Priority **A** · effort **M** · **7 registrations**

**Registrations:** `Arcane Denial`; `Braids, Conjurer Adept`; `Dark Confidant`; `Dark Tutelage`; `Ripples of Undeath`; `Test of Endurance`; `Wall of Shards`.

**Shared work:** Upkeep/first-main timing with player/turn filters and intervening conditions.

**Required support / secondary gates:** Dark Confidant/Dark Tutelage share the exact reveal/top-to-hand/mana-value life-loss program. Braids needs active-player optional hand placement; Ripples needs a paid recovery from the milled set; Test needs win-game instruction; Wall needs cumulative-upkeep payment and counters. Arcane Denial uses next-turn upkeep delayed draws rather than a permanent upkeep trigger; share scheduling, preserve its optional up-to-two draw.

### 14. Greatest power and characteristic arithmetic

Priority **A** · effort **M** · **13 registrations**

**Registrations:** `Archdruid's Charm`; `Black Sun's Twilight`; `Blossoming Tortoise`; `Field of the Dead`; `Finale of Devastation`; `Overwhelming Stampede`; `Pathbreaker Ibex`; `Profane Command`; `Return of the Wildspeaker`; `Rishkar's Expertise`; `Sandstone Oracle`; `Singularity Rupture`; `Will of the Sultai`.

**Shared work:** Counts/maxima/differences captured at the correct time and used in draw, search, pump or mill.

**Required support / secondary gates:** Overwhelming Stampede/Pathbreaker Ibex share maximum-power team pump; Return of the Wildspeaker/Rishkar share maximum-power draw. Add max and numeric arithmetic, non-Human filters and per-player library counts. Other gates: multi-zone search/free casting, fear, nonzero/conditional modes, and correct Black Sun’s Twilight return behavior. Archdruid’s Charm needs land-versus-creature search destinations and one-way power damage (not fight). Blossoming Tortoise also needs land activation-cost reductions and static land-creature pump; Field of the Dead needs distinct land-name counting.

### 15. Player and object comparison predicates

Priority **A** · effort **M** · **6 registrations**

**Registrations:** `Archaeomancer's Map`; `Beza, the Bounding Spring`; `Guardian Project`; `Homer, the Hermit`; `Moonsilver Key`; `Pit of Offerings`.

**Shared work:** Compare land/creature/hand counts, distinct names, subtype unions, mana-ability predicates or linked colors.

**Required support / secondary gates:** Archaeomancer’s Map/Beza share cross-player counts; Guardian Project needs same-name exclusion in two zones; Homer needs multiplication and subtype-union counts; Moonsilver requires mana-ability classification; Pit requires linked-exile color queries. Only some become ready after each predicate slice.

### 16. Pay-life modal lands

Priority **B** · effort **L** · **6 registrations**

**Registrations:** `Boggart Trawler // Boggart Bog`; `Bridgeworks Battle // Tanglespan Bridgeworks`; `Fell the Profane`; `Fell the Profane // Fell Mire`; `Sea Gate Restoration // Sea Gate, Reborn`; `Sink into Stupor // Soporific Springs`.

**Shared work:** Modal face handoff plus optional pay-3-life entry replacement on the land face. Fell the Profane’s two keys are aliases of the same physical card.

**Required support / secondary gates:** Depends on pay-life entry; full front-face programs also need fight/pump, stack-or-permanent bounce, hand-size arithmetic/permanent unlimited grant. Do not count the shared land face as a complete migration.

### 17. Conditionally tapped lands

Priority **B** · effort **M** · **3 registrations**

**Registrations:** `Choked Estuary`; `Hagra Mauling // Hagra Broodpit`; `Mystic Sanctuary`.

**Shared work:** Entry condition determines tapped state.

**Required support / secondary gates:** Hand reveal payment (Choked Estuary); other-Island count and actual untapped entry trigger (Mystic Sanctuary); opponent basic-land condition for Hagra Mauling’s spell cost. These are related replacement/filter infrastructure, not identical cards.

### 18. Linked exile and return

Priority **B** · effort **L** · **12 registrations**

**Registrations:** `Alabaster Host Intercessor`; `All-Fates Stalker`; `Angel of Sanctions`; `Banisher Priest`; `Bishop of Binding`; `Endless Sands`; `Fiend Hunter`; `Glorious Protector`; `Lumbering Battlement`; `Palace Jailer`; `Phyrexian Ingester`; `Werefox Bodyguard`.

**Shared work:** Exile selected objects and retain their identities for a later return or linked characteristic query.

**Required support / secondary gates:** Separate until-source-leaves duration from independent ETB/LTB triggers (Fiend Hunter); owner-controlled return; multiple linked cards; linked P/T/counts; monarch endpoint (Palace Jailer). Additional gates: cycling, warp, embalm, foretell, and ordinary activated abilities.

### 19. Life-total and history operations

Priority **B** · effort **L** · **8 registrations**

**Registrations:** `Children of Korlis`; `Mirkwood Bats`; `Mirror Universe`; `Mister Negative`; `Repay in Kind`; `Souls of the Faultless`; `Sygg, River Cutthroat`; `Tainted Sigil`.

**Shared work:** Life-loss history, actual life changes, totals/exchange, damage-triggered or token-triggered drains.

**Required support / secondary gates:** History queries and aggregation; exchange/set-life semantics; damage/token/sacrifice and end-step occurrences; signed life-total minimum for Repay in Kind. Children of Korlis and Tainted Sigil share history infrastructure, but use different player scopes.

### 20. Counter restrictions and alternatives

Priority **B** · effort **L** · **6 registrations**

**Registrations:** `Decisive Denial`; `Desertion`; `Dovin's Veto`; `Keep Safe`; `Mana Drain`; `Wash Away`.

**Shared work:** Counter spells with conditional eligibility, payment, alternate casting, or a delayed follow-up.

**Required support / secondary gates:** Targeting relationships (Keep Safe); unless-pay (Decisive Denial); uncounterable spells; casting-origin filter and cleave (Wash Away); counter-to-battlefield destination (Desertion); next-main mana (Mana Drain). Reuse controller references from the preceding group.

### 21. Combat and keyword rules

Priority **B** · effort **L** · **8 registrations**

**Registrations:** `Archangel of Tithes`; `Archetype of Endurance`; `Baird, Steward of Argive`; `Concordant Crossroads`; `Sire of Seven Deaths`; `Standard Bearer`; `Thunderfoot Baloth`; `Void Winnower`.

**Shared work:** Continuous keyword grants/suppression, combat restrictions, taxes and target requirements.

**Required support / secondary gates:** Concordant Crossroads is the small first slice (static haste grant). Other slices need attack/block taxes, cannot-gain suppression, missing keywords/ward, commander condition, even-mana-value restrictions, or Flagbearer targeting obligations. Do not implement as one giant mechanic.

### 22. Continuous types and characteristics

Priority **B** · effort **L** · **10 registrations**

**Registrations:** `Blanket of Night`; `Colossification`; `Curious Colossus`; `Kindred Dominance`; `Lumra, Bellow of the Woods`; `Maskwood Nexus`; `Mossborn Hydra`; `Raise the Palisade`; `Urborg, Tomb of Yawgmoth`; `Yavimaya, Cradle of Growth`.

**Shared work:** Land type overlays, all-creature-types, Aura attachment effects, base characteristics and counter scaling.

**Required support / secondary gates:** Blanket of Night/Urborg share Swamp overlay; Yavimaya is the Forest variant. Add layer-aware type changes/intrinsic mana, changeling in every applicable zone, attachment references and ability loss; counter-count arithmetic for Mossborn Hydra.

### 23. Restricted and uncounterable mana

Priority **B** · effort **M** · **2 registrations**

**Registrations:** `Cavern of Souls`; `Delighted Halfling`.

**Shared work:** Mana with spending restrictions and an uncounterable flag for qualifying spells.

**Required support / secondary gates:** Typed mana provenance, spending restrictions, spell counterability, and chosen creature type (Cavern). Do not model these as unrestricted five-color mana.

### 24. Land animation and crew

Priority **B** · effort **L** · **4 registrations**

**Registrations:** `Firdoch Core`; `Hall of Storm Giants`; `Hedge Shredder`; `Lair of the Hydra`.

**Shared work:** Temporary type/base-P/T changes while retaining land/artifact characteristics.

**Required support / secondary gates:** Firdoch Core needs changeling too; Hall needs ward and conditional tapped entry; Lair needs nonzero X. Hedge Shredder additionally needs crew costs and grouped library-to-graveyard land occurrences.

### 25. Conditional casting costs

Priority **B** · effort **L** · **12 registrations**

**Registrations:** `Analyze the Pollen`; `Cling to Dust`; `Drag to the Roots`; `Dread Return`; `Getaway Glamer`; `Joint Exploration`; `Mulldrifter`; `Parting Gust`; `Pile On`; `Price of Fame`; `Snuff Out`; `Tear Asunder`.

**Shared work:** Alternate/additional costs, conditional reductions and mode-dependent programs.

**Required support / secondary gates:** Distinct reusable slices for kicker, collect evidence, delirium, flashback/escape, spree, gift, convoke, and alternative life payment. Joint Exploration/Tear Asunder form a kicker sub-batch; do not omit printed costs/clauses during migration.

### 26. Graveyard and top-library play permissions

Priority **B** · effort **L** · **9 registrations**

**Registrations:** `Ancient Greenwarden`; `Courser of Kruphix`; `Forgotten Cellar`; `Icetill Explorer`; `Mole Man, Moloid Master`; `Six`; `Starfield of Nyx`; `Valgavoth, Terror Eater`; `Walk-In Closet`.

**Shared work:** Play cards from a non-hand zone; scope permissions by card kind, turn and source.

**Required support / secondary gates:** Walk-In Closet/Forgotten Cellar are two keys for the same Room. Ancient Greenwarden/Icetill/Mole Man/Six share graveyard land permissions but have additional mechanics. Courser needs public top-card visibility; Starfield needs upkeep return/animation; Valgavoth needs replacement-linked exile and life payment. Also retrace, Room unlock and trigger multiplication dependencies.

### 27. Hand placement and repetition

Priority **B** · effort **L** · **3 registrations**

**Registrations:** `Eureka`; `Hypergenesis`; `Show and Tell`.

**Shared work:** Each player may put a qualifying permanent from hand onto the battlefield in turn order.

**Required support / secondary gates:** Show and Tell is the single-round base; Eureka/Hypergenesis repeat until an entire round declines. Preserve APNAP choices and trigger checkpoints. Hypergenesis additionally needs suspend/no-mana-cost casting support.

### 28. Copy modifications and control

Priority **B** · effort **L** · **9 registrations**

**Registrations:** `Irenicus's Vile Duplication`; `It That Betrays`; `Mirrorweave`; `Nanogene Conversion`; `Quantum Misalignment`; `Reins of Power`; `Sakashima of a Thousand Faces`; `Spark Double`; `Thespian's Stage`.

**Shared work:** Token or temporary copy effects with exceptions, control changes and captured identities.

**Required support / secondary gates:** Irenicus’s Vile Duplication and Quantum Misalignment share nonlegendary token-copy modifiers; Mirrorweave/Nanogene share temporary creature copying. Other gates: rebound, clone-as-entry, legend-rule exemption, copied abilities, sacrifice occurrence/annihilator (It That Betrays), and control exchange (Reins of Power).

### 29. Ability copies and trigger multiplication

Priority **B** · effort **L** · **5 registrations**

**Registrations:** `Rings of Brighthearth`; `Roaming Throne`; `Vantress Visions`; `Virtue of Knowledge`; `Yarok, the Desecrated`.

**Shared work:** Copy activated/triggered stack abilities; duplicate qualifying trigger occurrences.

**Required support / secondary gates:** Vantress Visions/Virtue of Knowledge are adventure/front-name registrations for the same physical card. Rings adds activation occurrence and optional payment; Roaming Throne adds chosen type/ward; Yarok needs all printed keywords. Ancient Greenwarden shares trigger multiplication but remains in the permission group.

### 30. Delayed return and death recovery

Priority **B** · effort **L** · **4 registrations**

**Registrations:** `Ephemerate`; `Kederekt Leviathan`; `Vanish into Memory`; `Woodfall Primus`.

**Shared work:** Return a captured card after a delayed event or death, with alternate-zone/casting rules.

**Required support / secondary gates:** Rebound (Ephemerate), unearth replacement/duration (Kederekt), delayed return-success-dependent discard (Vanish), persist and last-known counters (Woodfall). Shares captured identity and timing with linked exile but has different return rules.

### 31. Filtered library searches

Priority **B** · effort **M** · **2 registrations**

**Registrations:** `Myriad Landscape`; `Waterlogged Teachings // Inundated Archive`.

**Shared work:** Library selection with relationships or ability predicates beyond a single type.

**Required support / secondary gates:** Myriad Landscape requires selected basics to share a land type; Waterlogged Teachings needs instant-or-flash filtering and both faces. Moonsilver Key shares ability classification (see comparison-predicate group).

### 32. Loyalty abilities

Priority **B** · effort **L** · **3 registrations**

**Registrations:** `Jace, Multiverse Architect`; `Teferi, Who Slows the Sunset`; `Ugin, the Spirit Dragon`.

**Shared work:** Loyalty costs, once-per-turn activation, mode/target announcement and permanent-source abilities.

**Required support / secondary gates:** Jace, Teferi and Ugin should share loyalty infrastructure before separate programs. Additional gates: emblems, damage targets, top-card selection, X/color/mana-value filters, and multi-card hand placement. Read complete Jace text before scoping its abilities.

### 33. Simultaneous discard and draw

Priority **B** · effort **M** · **1 registration**

**Registrations:** `Windfall`.

**Shared work:** Windfall uses the largest actual discarded count across players.

**Required support / secondary gates:** Per-player iteration, discard-hand count results, numeric maximum, and correct simultaneous-event checkpoints. Reuses result arithmetic but cannot use starting hand counts as a substitute.

### 34. Damage occurrences and defending player

Priority **B** · effort **L** · **4 registrations**

**Registrations:** `Apex Altisaur`; `Breena, the Demagogue`; `Grothama, All-Devouring`; `Kogla, the Titan Ape`.

**Shared work:** Fight/damage and attack triggers that retain the affected or defending player.

**Required support / secondary gates:** Apex requires enrage; Grothama requires source-attributed damage history; Breena requires defender life comparisons; Kogla requires defending-player filters. Shared event references first, individual programs second.

### 35. Turn/event ordinals and grouped occurrences

Priority **B** · effort **L** · **6 registrations**

**Registrations:** `Crawling Sensation`; `Lotho, Corrupt Shirriff`; `Queza, Augur of Agonies`; `Scute Swarm`; `Wedding Ring`; `Zimone and Dina`.

**Shared work:** First/second events, grouped occurrences, source-name or turn filters, and branching.

**Required support / secondary gates:** Crawling Sensation needs first land-to-graveyard group; Lotho second spell; Zimone and Dina second draw and optional repeat. Scute needs token copy; Wedding Ring needs cast provenance, opponent membership and draw/life events; Queza primarily needs existing draw targeting composition. Start with Queza, then add the shared history queries.

### 36. Conditional exile payment

Priority **B** · effort **M** · **1 registration**

**Registrations:** `Masked Vandal`.

**Shared work:** Masked Vandal announces an artifact/enchantment target, then may exile a graveyard creature on resolution.

**Required support / secondary gates:** Canonical changeling plus optional typed selection and exile-success condition. Shares ordinary exile/target infrastructure; avoid converting the resolution action into an announcement cost.

### 37. Mass sacrifice and return triggers

Priority **B** · effort **M** · **2 registrations**

**Registrations:** `Portal to Phyrexia`; `Rankle, Master of Pranks`.

**Shared work:** Per-player sacrifice choices and triggered programs.

**Required support / secondary gates:** Portal has opponent sacrifice-three plus upkeep targeted reanimation/type addition; Rankle has combat-damage-to-player occurrence and any-number modes. Shared player iteration and sacrifice instructions, with distinct scheduling gates.

### 38. Random exile and repeated copying

Priority **B** · effort **L** · **1 registration**

**Registrations:** `Sin, Spira's Punishment`.

**Shared work:** Randomly exile a graveyard permanent, create a tapped copy, and repeat for a land.

**Required support / secondary gates:** Sin requires random graveyard selection, captured-card copying, tapped tokens, and land-dependent repetition.

### 39. Pile division and voting

Priority **C** · effort **L** · **11 registrations**

**Registrations:** `Coercive Portal`; `Council's Judgment`; `Círdan the Shipwright`; `Erestor of the Council`; `Fact or Fiction`; `Fortune's Favor`; `Illusion of Choice`; `Sail into the West`; `Selvala's Stampede`; `Split Decision`; `Trap the Trespassers`.

**Shared work:** Player-owned choices over piles or public/secret votes, followed by result-dependent programs.

**Required support / secondary gates:** Canonical typed vote/pile data, private visibility and restore, ties and voter aggregates. Fact or Fiction/Fortune’s Favor share division infrastructure but differ in who sees/chooses; council and secret-council variants are separate semantics.

### 40. Saga chapter programs

Priority **C** · effort **L** · **4 registrations**

**Registrations:** `Awaken the Honored Dead`; `Kiora Bests the Sea God`; `Summon: Leviathan`; `Summon: Titan`.

**Shared work:** Lore progression, chapter triggers and final-chapter sacrifice.

**Required support / secondary gates:** Reusable Saga scheduling first, then chapter composition. Additional gates include reflexive discard trigger (Awaken), skip-untap/control gain (Kiora), creature-type exclusions and temporary attack triggers (Leviathan), and counted P/T grants (Titan).

### 41. Token-copy activated alternatives

Priority **C** · effort **L** · **3 registrations**

**Registrations:** `Belonging`; `Soul of Eternity`; `Springheart Nantuko`.

**Shared work:** Token generation/copy exceptions and alternate activation/casting mechanics.

**Required support / secondary gates:** Encore with one token per opponent and attack requirements (Belonging/Soul); bestow and attached-copy branching (Springheart). Changeling and life-based characteristic definition are additional dependencies.

### 42. Special replacement/protection packages

Priority **C** · effort **L** · **6 registrations**

**Registrations:** `Blightsteel Colossus`; `Darksteel Colossus`; `Everybody Lives!`; `Perch Protection`; `Phial of Galadriel`; `Tenuous Truce`.

**Shared work:** Replacement, protection, phasing, player-level restrictions and attached-player relationships.

**Required support / secondary gates:** Darksteel/Blightsteel share reveal-and-shuffle graveyard replacement (Blightsteel also infect). Phial shares conditional draw/life replacement. Everybody Lives/Perch need player life/game-result restrictions and protection; Tenuous Truce needs enchanted-player event relationships. Keep these as focused sub-batches.

### 43. Adventure land and Room programs

Priority **C** · effort **L** · **3 registrations**

**Registrations:** `Marina Vendrell`; `Niv-Mizzet, Ghost Counsel`; `Zanarkand, Ancient Metropolis // Lasting Fayth`.

**Shared work:** Multiple playable faces or unlocked doors with independent programs and permissions.

**Required support / secondary gates:** Marina/Niv need full cached/source-text review and Room/eerie/door support; Zanarkand needs adventure exile permission and counted counters on the newly created token. Reuse face handoff; do not migrate just the easy land face.

### 44. Delayed blink and special casting packages

Priority **C** · effort **L** · **3 registrations**

**Registrations:** `Incarnation Technique`; `Kuroki, Thief of Talents`; `Nezahal, Primal Tide`.

**Shared work:** Programs that combine ordinary effects with casting/copy permissions or delayed returns.

**Required support / secondary gates:** Incarnation Technique needs demonstrate and opponent spell copies; Kuroki needs end-step offer plus private opponent-hand casting permission; Nezahal needs uncounterability and delayed self-return in addition to existing cast triggers/unlimited hand size.

## Completion and maintenance

- Before starting a batch, check existing GitHub reports, confirm full Oracle behavior, and inspect the current DSL rather than assuming a legacy shortcut is correct.
- Implement reusable semantics and mechanic-owned tests once. Use structural catalog checks for each definition and existing integration coverage where suitable.
- Remove a legacy registration only after every behavior of that card/face is canonical. Shared support may unlock only part of a larger card.
- Commit and push each coherent completed set to #432. A primary group can require several commits; unrelated secondary systems should remain separate.
- After a migration, remove its key from this inventory and regenerate the coverage ledger. Update counts and priorities; keep aliases separate until their legacy keys are actually removed.
- Snapshot validation: remaining ledger keys are present exactly once; no unknown keys. Hosted CI is not awaited on this branch, as requested.
