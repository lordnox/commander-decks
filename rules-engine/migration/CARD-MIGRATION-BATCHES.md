# Card migration strategy: mechanics first

Snapshot: PR #432 after Kuroki composition (Kuroki, Thief of Talents migrated), plus completing family 41 (encore and bestow Available; Belonging and Soul of Eternity migrated), plus completing family 26 (all ten contracts Available; Walk-In Closet // Forgotten Cellar migrated with source-independent resolved rules), plus completing family 25 (all 19 contracts Available; Angel of Sanctions, Glorious Protector, Pitiless Carnage, Hypergenesis, and All-Fates Stalker migrated), plus family 25-evidence (Analyze the Pollen migrated), plus family 28 complete (all seven contracts Available; Ephemerate, Quantum Misalignment, Incarnation Technique, Reins of Power, Sakashima of a Thousand Faces, Spark Double, Mirrorweave, Nanogene Conversion, and Thespian's Stage migrated), plus family 30 return-success follow-up and unearth (Vanish into Memory and Kederekt Leviathan migrated; family 30 complete), plus family 25-flashback and 25-escape (Dread Return and Cling to Dust migrated; family 25 is now complete), plus family 39 piles/voting (all six remaining registration keys migrated), plus family 26-exile-play, 26-graveyard-spells, 26-retrace, and 26-exile (Six and Valgavoth, Terror Eater migrated; Forgotten Cellar / Walk-In Closet migrated with 26-graveyard-replacement), plus family 29 ability copies and trigger multiplication (all six registration keys migrated), plus family 27-place and 27-repeat (Show and Tell and Eureka migrated; Hypergenesis migrated with family 25 suspend), plus family 24 animation/crew (Firdoch Core, Hall of Storm Giants, Lair of the Hydra, Hedge Shredder migrated), plus family 26-permission and 26-hand (Rishkar's Expertise migrated), plus family 42-shuffle (Blightsteel Colossus and Darksteel Colossus migrated), plus family 30-persist (Woodfall Primus migrated), plus Parting Gust, plus family 43-adventure (Zanarkand, Ancient Metropolis // Lasting Fayth migrated; Virtue of Knowledge / Vantress Visions migrated with family 29), plus family 41 bestow (Springheart Nantuko migrated; encore is now Available and both remaining cards have migrated), plus family 37 player-sacrifice and any-number triggered modes (Portal to Phyrexia and Rankle, Master of Pranks migrated), plus conditional modal counts and family 35 event-history slices (Crawling Sensation, Lotho, It That Betrays, Wedding Ring, Zimone and Dina, and Niv-Mizzet, Ghost Counsel migrated; Hedge Shredder migrated with family 24), plus paid-mode composition, convoke, cleave/evoke, conditional spell-cost reductions, shared casting costs/kicker, plus family 23 restricted mana (Cavern of Souls and Delighted Halfling migrated), plus family 32 loyalty and emblems (Ugin, Teferi, and Jace migrated), plus family 21 combat keywords, the family 26 land-permission slice, family 22 and cumulative upkeep, cycling correctness fixes and Alabaster Host Intercessor, plus families 12, 22-land-types, and 31, including Dakmor Salvage, Life from the Loam, Blanket of Night, Urborg, Yavimaya, Waterlogged Teachings, Myriad Landscape, and Finale of Devastation, plus the prior Sail into the West / Mirkwood Bats and families 38 and 40; continues #394 and #383. **5 legacy registration keys remain.** This counts exact registration keys, including aliases/faces, rather than distinct physical cards. Palace Jailer, Ripples of Undeath, Phial of Galadriel, and the family 39 public pile/vote cards remain canonical from the prior snapshot.

Implement reusable mechanics independently, then migrate every card whose complete set of prerequisites is available. A card can depend on several mechanics and does not belong to one implementation group. Completing a mechanic does not require migrating cards blocked by another mechanic.

**173 mechanic entries:** 169 available, 0 awaiting correctness follow-up, and 4 open work items. These are planning slices, not equal effort units. Counts of dependent cards overlap and must not be added.


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
- **Review:** canonical support exists, but identified correctness work remains. Cycling issues [#440](https://github.com/lordnox/commander-decks/issues/440) and [#441](https://github.com/lordnox/commander-decks/issues/441) are addressed on this branch; their fixes remain subject to PR review and merge.
- **Open:** implement or verify the missing reusable contract before depending on it. Multiple keywords/cost variants inside a row may warrant separate commits.
- **Composition candidate:** all *known* mechanic dependencies are available; still needs current Oracle/ruling review and composition validation. This is not a claim that the card is implemented.
- **Source review:** the planning lookup did not resolve a complete cached source for that card. Its dependency set is provisional; resolve the complete specification before claiming readiness.

Sources: the current canonical [schema](../src/cardPlugins/dsl/schema/v1.ts), builders/runtime, [coverage ledger](rule-dsl-coverage-ledger.json), legacy registrations, prior migration inventory, and cached `cards/*.json`. This is a dependency-planning pass, not a fresh live Oracle audit of all 173 registrations. Ordinary supported operations (draw, gain/lose life, selectors, typed choices, counters, moves, modes, and similar composition) are assumed; the lists emphasize additional mechanics and relevant already-available shared dependencies.

## What changed from the card batches

The historical family numbers 01–44 remain stable for earlier discussions. Suffixes identify independent mechanic work inside a family. A numbered family is a navigation heading, not a requirement to finish all of its rows together. New cross-family dependencies are explicit. The old unique card-to-batch ownership rule is retired. The **Former batch** column in the card list is historical provenance only.

- **08 is available:** bounded top-library selection is complete as a mechanic. Six original cards have migrated, including Dack Fayden, Helping Hand. Dig Through Time has migrated with **25-delve**. Famished Worldsire has migrated with **09-devour** and **21-ward**. Jace, Multiverse Architect and Teferi, Who Slows the Sunset have migrated with **32-loyalty**. Hostile Negotiations has migrated with **39-hidden**.
- **09-count is available:** Reprocess, Scapeshift, and Victimize have migrated. Pitiless Carnage still needs plot. Deferred choices for the same player now reopen correctly (#444).
- **09-devour is available:** entry-replacement devour chooses eligible permanents, sacrifices as the creature enters, and stamps +1/+1 counters from the actual count before ETB observers and SBAs. Land devour is included, including on a resolving creature spell. Famished Worldsire has migrated.
- **13-step is available:** native step triggers and their active-player context are canonical. Dark Confidant, Dark Tutelage, Braids, and Arcane Denial have migrated. Delayed callbacks can exclude the current turn.
- **13-delayed-main is available:** next precombat or postcombat main of a specified player, whichever occurs first, retains captured amounts after the source leaves. Mana Drain has migrated.
- **14-add is available:** unsigned amount addition composes with counts and other amounts. Sea Gate Restoration has migrated with **16-hand-limit** and **16-faces**.
- **14-greatest is available:** maximum power (or toughness, mana value, loyalty) over an object set drives pump and draw. Overwhelming Stampede, Pathbreaker Ibex, Return of the Wildspeaker, and Rishkar's Expertise have migrated.
- **14-filter is available:** object filters compare power, toughness, mana value, or loyalty against X and other amounts, including greatest-power ties. Black Sun's Twilight and Finale of Devastation have migrated. Getaway Glamer still needs **25-spree**; Profane Command has migrated with **21-fear**; Rishkar's Expertise has migrated with **26-hand**; Ugin, the Spirit Dragon has migrated with **32-loyalty**.
- **25-delve is available:** Dig Through Time has migrated. Remaining 25-family costs stay open.
- **07 is available:** both implementation slices landed. Fractured Identity, Settle the Wreckage, and Terastodon are no longer pending.
- **09 separates sacrifice results from devour. 25 separates delve, kicker, evidence, and each alternate cost. 39 separates public piles, hidden piles, public votes, and secret votes.** Implementing one does not require completing its entire former bucket.
- **44 is retired as an implementation group:** its three cards now reference the actual mechanics—demonstrate, timing/hand casting, or counterability.
- Correct planning shortcuts from the former list: Dack is a creature; Bender's Waterskin needs other-player untap participation; Rain of Filth grants activated abilities; Sail into the West uses public voting; Trap the Trespassers uses secret creature votes and existing stun counters. Niv-Mizzet has no established Room dependency.

- **37-modes and 37-sacrifice are available:** triggered abilities can choose any allowed subset of modes at placement, including zero; per-player sacrifice requests clamp to available permanents. Portal to Phyrexia and Rankle, Master of Pranks have migrated.

- **15 is available:** player choice/iteration, commander status, quantified player comparisons, mana-ability filters, and name queries are canonical. Beza, Guardian Project, Field of the Dead, Moonsilver Key, and Singularity Rupture have migrated. Other consumers retain their independent prerequisites.
- **16-hand-limit and 16-stack-object are available:** Sea Gate Restoration // Sea Gate, Reborn and Sink into Stupor // Soporific Springs have migrated with pay-life MDFC composition.
- **43-room is available:** door programs, unlock/fullyUnlock occurrences, and lock-or-unlock instructions compose onto kernel Room doors. Marina Vendrell has migrated. Walk-In Closet // Forgotten Cellar has migrated with family 26.

- **43-adventure is available:** resolving an Adventure face exiles the card adventured, then the permanent face may be cast or, for a land, played from exile. Zanarkand, Ancient Metropolis // Lasting Fayth has migrated. Virtue of Knowledge / Vantress Visions migrated with family 29. Generic flashback-style spell permissions remain **26-permission**.

- **30-persist is available:** a dies trigger with an intervening if over last-known battlefield `-1/-1` counters returns the graveyard identity under its owner with a `-1/-1` counter as it enters. Woodfall Primus has migrated.

- **42-shuffle is available:** an all-zone static replacement redirects a nontoken card's graveyard move to its owner's library, then reveals and shuffles after the redirected move. Tokens and cards already in a graveyard are skipped. Blightsteel Colossus and Darksteel Colossus have migrated.

- **26-permission and 26-hand are available:** temporary spell-cast permissions record identity, cost policy, remaining uses, and as-though-flash, then integrate with canonical announcement and decline. `offerCast` opens a one-shot private-hand (or specific-object) offer. Rishkar's Expertise and Kuroki, Thief of Talents have migrated; Kuroki composes a target-opponent instruction choice with a cross-player `offerCast` that inspects that hand and takes control of the cast spell.

- **17 is available:** conditional tapped entry uses the prospective controller; optional hand reveals use private typed choices followed by public reveal; entry counters accept constants, paid-cost counts on the move, or captured replacement results before observers and state-based actions. Mystic Sanctuary and Choked Estuary have migrated. Hall of Storm Giants/Lair of the Hydra still need animation (and ward composition for Hall); Mossborn Hydra has migrated with counter-count amounts; Everflowing Chalice retains its multikicker gate. Spark Double has migrated with copy-as-entry. Famished Worldsire has migrated.

- **10-colors is available:** canonical `addManaFrom` queries possible mana types at resolution and in planning, ignoring activation costs/tapped state and propagating types through a finite fixed point. Cyclic pools without a producer contribute no type. Exotic Orchard, Fellwar Stone, Reflecting Pool, and all three Horizon of Progress abilities have migrated; Horizon retains its life payment. The other six mana-production slices are now also available.

- **10 is complete:** all seven mana-production contracts are available. The remaining nine consumers have migrated, preserving hybrid filters, strict mill costs/instant-only timing, actual tap transitions, immediate bonuses, recurring cleanup-scoped callbacks, extort from actual loss, Aura chosen colors/host controllers, and static mana-loss consequences. Typed Aura spell entry is tracked separately as **22-aura**; broader attachment mechanics remain open.

**21-reach and 21-fear are available:** canonical printed and temporary keywords use the shared blocking checks. Fear admits artifact or black creatures and preserves other restrictions. Profane Command has migrated with all four modes; reach consumers retain their other gates.

**21-static and 21-suppress are available:** filtered and conditional keyword grants, conditional stat modifiers, and cannot-have-or-gain suppression use canonical printed-static lifetimes. Thunderfoot Baloth and Archetype of Endurance have migrated. Concordant Crossroads retains its newly identified **42-world** gate.

**14-difference and 14-counters are available:** nonnegative subtraction composes with current counts; named counter amounts preserve captured object identity and read the current count at each instruction. Sandstone Oracle and Mossborn Hydra have migrated, including the former’s non-target opponent choice and the latter’s entry replacement.

**20 original contracts are available:** printed uncounterability, counter destination, cast-origin filters, counter-unless-pay by the targeted spell's controller, and stack targeting relationships are canonical. Dovin's Veto, Desertion, Keep Safe, Decisive Denial, and Nezahal have migrated. Qualified-mana uncounterability stays in **23-mana**; remaining origin and payment consumers still need plot, adventure, or provenance.

**13-untap, 21-lifelink, and 21-menace are available:** other-player untaps join the turn-based untap action, lifelink works with actual damage and sources outside the battlefield, and menace restricts blocker declarations. Bender's Waterskin, Mister Negative, and Sire of Seven Deaths have migrated. Kuroki, Thief of Talents has migrated.

**14-result-max and 33-discard are available:** per-player programs can keep a surviving maximum of actual action results such as discarded counts; whole-hand discards bind those counts after replacement. Windfall has migrated.

**14-signed-minimum and 21-first-strike are available:** signed lowest-life queries are restricted to life-total consumers; Repay in Kind has migrated. First-strike eligibility is captured by object identity for both damage steps, surviving restore and keyword changes. Sire of Seven Deaths has migrated with its printed combat keywords and Ward—Pay 7 life.

**36-exile is available:** `exileForEffect` composes a typed optional one-card choice, exile, and conditional continuation from canonical instructions. Its payment condition follows CR 118.12, including modified destinations; mechanic tests cover decline, no eligible cards, countering, illegal targets, and journal restore. Masked Vandal remains unmigrated because **22-changeling** is Open; do not omit its all-creature-types ability.

**18-links is available:** identity-pinned sets now compose Bishop of Binding, Endless Sands, Lumbering Battlement, Phyrexian Ingester, and Pit of Offerings. Embedded cached Scryfall data preserves Vampire-only attack targets, nontoken optional exile, both land mana modes, independent signed power/toughness bonuses, and owner-controlled returns. The separate **18-monarch** contract is now also Available; Palace Jailer has migrated with both independent ETB abilities.

**39-piles and 39-vote are available:** public opponent partitions bind chosen and remainder piles without auto-moving; sequential public votes, including object ballots and tallies/leads, continue canonical programs. Fact or Fiction, Council's Judgment, Coercive Portal, Split Decision, and Selvala's Stampede have migrated. Fortune's Favor and Hostile Negotiations still need **39-hidden**. Illusion of Choice still needs **39-control**; Erestor still needs **39-finished**; Círdan still needs **39-secret**; Trap still needs **39-secret** and **39-object**. Sail into the West has migrated with 39-exile and 15-simultaneous.

**Group 18 is complete:** all four linked-exile contracts are Available. Palace Jailer uses canonical source-less monarch triggers and incarnation-pinned, source-independent exile duration. Cards still listed under former batch 18 retain external gates such as cycling, warp, embalm, and foretell; completing linked exile does not implement those mechanics.

**38-random, 38-tapped, 38-repeat, and 38-token-refs are available:** authoritative `chooseRandom` persists through the journal, tapped copies exist before ETB observers, `repeatWhile` rebinds the latest qualifying result, and `createToken`/`copy` can bind the new identities. Sin, Spira's Punishment has migrated. Zanarkand has migrated with **43-adventure**.

**40-saga and 40-skip are available:** canonical saga abilities feed kernel lore, chapter triggers, and CR 714.4 sacrifice; `tap` can skip the controller's next untap. Awaken the Honored Dead, Kiora Bests the Sea God, Summon: Titan, and Summon: Leviathan have migrated.

**12-dredge is available:** a `{ kind: 'dredge', count }` ability is an optional draw replacement that mills the printed number and returns the card. Dakmor Salvage and Life from the Loam have migrated.

**22-land-types is available:** `grantLandType` adds a basic land type in layer 4 and confers that type's intrinsic mana ability in addition to printed tap abilities. Blanket of Night, Urborg, Tomb of Yawgmoth, and Yavimaya, Cradle of Growth have migrated.

**31-flash, 31-related, and 31-multizone are available:** object filters match printed and granted keywords, selected cards can be required to share a basic land type, and a multi-zone search shuffles only when a library card was chosen. Waterlogged Teachings // Inundated Archive, Myriad Landscape, and Finale of Devastation have migrated.

**22 is available:** characteristic definitions, additive types, ability loss, creature-type choices, changeling, object/player attachments, and instruction-based activated grants are canonical. Ten fully eligible cards have migrated; remaining consumers retain external gates. **13-upkeep is available:** Wall of Shards has migrated with durable counted payments and separate opponent choices.

**21 is available:** annihilator, infect, even-mana-value restrictions, Flagbearer targeting, attack/block taxes, and ward (mana, life, and sacrifice) are canonical printed statics or keyword/composed triggers. Archangel of Tithes, Baird, Steward of Argive, Standard Bearer, Void Winnower, Sire of Seven Deaths, Famished Worldsire, and Summon: Leviathan have migrated. Remaining former-21 consumers retain external gates such as shuffle-instead, animation, multiply, group sacrifice, or exile.

## Suggested next work

Choose a small mechanic that unlocks cards, rather than implementing entire broad families in numeric order:

| Mechanic | Cards it can unlock after review | Other gates |
| --- | --- | --- |
| [42-player](#42-player) | Everybody Lives!, Perch Protection | Perch Protection also needs [42-turn](#42-turn). |
| [42-world](#42-world) | Concordant Crossroads | — |
| [42-regeneration](#42-regeneration) | Snuff Out | — |

**No composition candidate remains.** Kuroki, Thief of Talents has migrated; the four remaining cards are gated by family 42 contracts.

## Mechanic groups

### 01. Targeting, captured identities, and death return

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="01"></a>**01 — Mixed targeting and identity-safe actions** | Available | Player/permanent target kinds; typed announcement choices; captured death-return identities. | — | None remaining |

### 02. Library search and destination composition

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="02"></a>**02 — Typed searches and split destinations** | Available | Search, reveal, select a subset, move to different destinations, and shuffle. Boseiju, Who Endures has migrated. | — | None remaining |

### 03. Cycling

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="03"></a>**03 — Cycling** | Available | Draw-cycling and typecycling emit on committed discard payment, before resolution; triggers survive countering. Self-cycling programs function in the discard destination, including redirected exile, and restore preserves pending targets/searches. Alabaster Host Intercessor has migrated. | — | None remaining |

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
| <a id="06"></a>**06 — Numeric results and amount composition** | Available | Multiplication, minimum, current/LKI characteristics, captured amounts, actual life-loss/damage totals, and colored X. Mirror Universe and Necrologia have migrated. | — | None remaining |

### 07. Action outcomes, captured players, and copy snapshots

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="07"></a>**07 — Object/player captures and outcome follow-ups** | Available | Controller/owner capture, actual move totals, destroyed-object snapshots, per-object follow-ups, persistent copiable snapshots, permanent control distribution, and lasting goad. Boseiju, Who Endures has migrated. | — | `Mirrorweave`; `Nanogene Conversion`; `Quantum Misalignment`; `Sakashima of a Thousand Faces`; `Spark Double`; `Thespian's Stage` |
| <a id="07-mill"></a>**07-mill — Bind cards from a mill action** | Available | `mill({ bindChoice })` binds first public destination identities, including additional replacement mills, excludes prevented/hidden destinations, and never follows later incarnations. Mechanic tests cover filtered recovery and restore. Ripples of Undeath has migrated with 20-combined-payment; Six has migrated with 26-retrace. | [07](#07) | None remaining |

### 08. Top-library inspection and selection

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="08"></a>**08 — Bounded inspection, reveal, and remainder movement** | Available | Public/private inspection, dynamic counts, eligible subsets, read-and-continue views, random bottom order, and new battlefield identity capture. The mechanic is available; remaining cards have dependencies elsewhere. | — | `Fortune's Favor`; `Hostile Negotiations` |

### 09. Sacrifice outcomes and entry sacrifice

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="09-count"></a>**09-count — Actual sacrifice counts** | Available | Typed optional choices, numeric `bindCount`, and independent boolean success bindings; count only selected object identities, survive replacement choices/restore, and ignore unrelated sacrifices. Reprocess, Scapeshift, and Victimize have migrated. | — | None remaining |
| <a id="09-devour"></a>**09-devour — Devour as an entry replacement** | Available | Choose eligible permanents and sacrifice as the creature enters; derive entry counters from the actual result. Include land devour, not a later ETB trigger. Nested sacrifices during a resolving creature spell apply immediately. Famished Worldsire has migrated. | [09-count](#09-count), [17-counters](#17-counters) | None remaining |

### 10. Mana production

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="10-attached"></a>**10-attached — Attached-land bonus mana** | Available | Mana triggers referring to the enchanted land and its controller; retain chosen-color bindings. | [22-aura](#22-aura), [10-bonus](#10-bonus) | None remaining |
| <a id="10-bonus"></a>**10-bonus — Tapped-for-mana triggers** | Available | Bonus mana keyed to land characteristics, controller, and the mana event; preserve mana-trigger timing. | — | None remaining |
| <a id="10-colors"></a>**10-colors — Available mana types** | Available | Query what own/opponent lands could produce, including colorless where applicable; avoid recursive Reflecting Pool loops. | — | None remaining |
| <a id="10-filter"></a>**10-filter — Hybrid/filter mana payments** | Available | Hybrid activation costs, mixed-color production choices, and planner support. | — | None remaining |
| <a id="10-loss"></a>**10-loss — Mana-loss consequences** | Available | Observe unspent mana being lost and apply the corresponding life loss. | — | None remaining |
| <a id="10-mill"></a>**10-mill — Mill as a cost** | Available | Pay a mill cost atomically before adding mana; reject an unpayable cost. | — | None remaining |
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
| <a id="12-dredge"></a>**12-dredge — Dredge draw replacement** | Available | Optional draw replacement, exact mill cost/library sufficiency, graveyard identity, competing replacements, and restore. Dakmor Salvage and Life from the Loam have migrated. | [10-mill](#10-mill) | None remaining |

### 13. Turn-step scheduling

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="13-step"></a>**13-step — Native step triggers** | Available | Typed native step occurrences match actual transitions, capture the active player, support player filters and generated grants, and check intervening conditions at capture/resolution. Dark Confidant, Dark Tutelage, Braids, Sygg, Test of Endurance, Crawling Sensation, Portal to Phyrexia, and Kuroki, Thief of Talents have migrated. | — | None remaining |
| <a id="13-delayed-main"></a>**13-delayed-main — Next main-phase scheduling** | Available | Schedule the next precombat or postcombat main phase of the specified player, whichever occurs first; retain captured amounts after the source leaves. | — | None remaining |
| <a id="13-untap"></a>**13-untap — Other-player untap participation** | Available | Untap qualifying permanents during other players' turn-based untap action, once per permanent with stun and phasing semantics. Bender's Waterskin has migrated. | — | None remaining |
| <a id="13-upkeep"></a>**13-upkeep — Cumulative upkeep** | Available | Age counters and optional full repeated payment compose through counted repetition, separate opponent choices, and sacrifice on decline. Wall of Shards has migrated. | [13-step](#13-step) | None remaining |

### 14. Amounts and characteristic queries

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="14-add"></a>**14-add — Amount addition** | Available | Add numeric amount expressions without using unsigned stat-delta shortcuts. | — | None remaining |
| <a id="14-counters"></a>**14-counters — Counter-count amounts** | Available | Read named current counter counts for production, doubling, or other numeric effects. Mossborn Hydra has migrated. | — | — |
| <a id="14-difference"></a>**14-difference — Nonnegative amount difference** | Available | Subtract player/object counts with the correct nonnegative floor for draw/effect counts. Sandstone Oracle has migrated. | — | None remaining |
| <a id="14-filter"></a>**14-filter — Dynamic characteristic filters** | Available | Object filters compare power, toughness, mana value, or loyalty against X and other amounts, including greatest-power ties. Black Sun's Twilight has migrated. | — | None remaining |
| <a id="14-greatest"></a>**14-greatest — Greatest characteristic** | Available | Compute/capture maximum power or another characteristic over an object set; use it for pump/draw. Overwhelming Stampede, Pathbreaker Ibex, Return of the Wildspeaker, and Rishkar's Expertise have migrated. | — | None remaining |
| <a id="14-signed-minimum"></a>**14-signed-minimum — Signed player-life minimum** | Available | Compute the lowest current life total across living players, including negative totals, once per set-life instruction. Repay in Kind has migrated. | — | None remaining |
| <a id="14-result-max"></a>**14-result-max — Maximum action result** | Available | Compute a maximum over per-player action results such as actual discarded counts; this does not require an object-power query. Windfall has migrated. | — | None remaining |

### 15. Predicates and player iteration

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="15-commander"></a>**15-commander — Commander predicates** | Available | Identify a controlled commander for lieutenant and announcement-time conditions. | — | — |
| <a id="15-compare"></a>**15-compare — Quantified player comparisons** | Available | Test whether any relevant opponent has more lands/creatures/hand cards/life; evaluate each player in the right scope. `somePlayerHasLess` is the inverse. Beza and Breena have migrated. | — | None remaining |
| <a id="15-each"></a>**15-each — Per-player instruction iteration** | Available | Run per-player programs in APNAP order with scoped player context, independent local choices/results, typed continuations, and parent-binding restoration. Rankle and Portal to Phyrexia have migrated. | — | `Círdan the Shipwright`; `Erestor of the Council`; `Eureka`; `Illusion of Choice`; `Show and Tell`; `Trap the Trespassers` |
| <a id="15-simultaneous"></a>**15-simultaneous — Collect per-player choices before shared actions** | Available | `chooseParticipants` and `chooseCardsForEachPlayer` collect choices in APNAP order without intervening actions, bind player/card sets, preserve private candidates, insufficient-card choices, and restore. `discardHands` discards the participating hands in one action group; subsequent draws retain APNAP order. Sail into the West has migrated. | [15-each](#15-each) | None remaining |
| <a id="15-mana"></a>**15-mana — Mana-ability classification filter** | Available | Select cards with intrinsic or canonically classified activated/eligible triggered mana abilities; targets and library movement follow the shared classifier. Moonsilver Key has migrated. | — | None remaining |
| <a id="15-names"></a>**15-names — Distinct and matching names** | Available | Count distinct current names and compare against current/LKI object names across battlefield/graveyard; Field of the Dead, Guardian Project, and Wedding Ring have migrated. | — | None remaining |
| <a id="15-player"></a>**15-player — Non-target player choice** | Available | Canonical choosePlayer reuses typed selectPlayers, binds a non-target player set, and preserves its player domain (including an empty set) in generated/delayed programs. | — | `Fortune's Favor`; `Hostile Negotiations`; `Parting Gust`; `Perch Protection` |

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
| <a id="17-counters"></a>**17-counters — Entry counters** | Available | Add counters as a permanent enters, from constants, paid-cost counts, or replacement results; entry observers must see them already present. | — | None remaining |

### 18. Linked exile

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="18-duration"></a>**18-duration — Exile until a source leaves** | Available | Link resulting exiled identities to source incarnation; return under owners, including source departure before/after resolution. | — | None remaining |
| <a id="18-links"></a>**18-links — Persistent linked-card sets** | Available | Persist source-incarnation and actual exiled-card identities; query current linked sets for later activations, signed power/toughness sums, counts, and current colors. Redirected/prevented exile creates no link; departing/reentered cards or fresh source incarnations do not inherit links. Return owner-controlled cards after source sacrifice; color-derived mana participates in planning. | — | None remaining |
| <a id="18-monarch"></a>**18-monarch — Monarch and linked duration** | Available | Become monarch; queue source-less inherent draw/crown-transfer abilities at priority checkpoints, retaining the original trigger controller. Read the damage creature’s current/last-known controller on resolution. Transfer on elimination and end source-independent exile on a captured player’s opponent acquiring the crown, including pre-resolution history. Restore and team relations are preserved; fixes #448. | — | None remaining |
| <a id="18-triggers"></a>**18-triggers — Independent exile/return triggers** | Available | Link separate ETB/LTB abilities (Fiend Hunter style), preserving their different timing from until-source-leaves. | [18-duration](#18-duration) | None remaining |

### 19. Life totals and game outcomes

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="19-exchange"></a>**19-exchange — Exchange and set life totals** | Available | Exchange as one semantic action, bind actual loss, and handle signed totals and life-change restrictions. Mirror Universe has migrated. | [06](#06) | None remaining |
| <a id="19-history"></a>**19-history — Life-loss history** | Available | Query life lost this turn by one player or all players; preserve actual rather than attempted losses. Children of Korlis, Tainted Sigil, and Sygg have migrated. | — | None remaining |
| <a id="19-win"></a>**19-win — Win-game instruction** | Available | Apply a canonical win instruction through game-result restrictions. Test of Endurance has migrated. | — | None remaining |

### 20. Countering and spell eligibility

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="20-counterability"></a>**20-counterability — Uncounterable spells** | Available | Persist and enforce printed uncounterability from `spell({ uncounterable })` and static `cannotBeCountered`. Dovin's Veto and Nezahal have migrated. Qualified-mana provenance stays in 23-mana. | — | None remaining |
| <a id="20-destination"></a>**20-destination — Conditional counter destination** | Available | On successful counter, move the original artifact/creature card to the battlefield instead of the graveyard. Desertion has migrated. | [07](#07) | None remaining |
| <a id="20-origin"></a>**20-origin — Cast-origin predicates** | Available | Filter by the zone/owner from which a spell was cast via stack/object `castFrom` and stack `owner`. Remaining consumers still need plot, adventure, or provenance. | — | `Vantress Visions`; `Virtue of Knowledge` |
| <a id="20-payment"></a>**20-payment — Counter unless a player pays** | Available | Resolution-time mana payment by the targeted spell's controller, with typed choices and mana opportunities. Decisive Denial has migrated. Remaining consumers retain animation, multiply, or exile gates. | — | `Hall of Storm Giants`; `Roaming Throne` |
| <a id="20-combined-payment"></a>**20-combined-payment — Combined optional resolution costs** | Available | `manaAndLifeCost` extends `payOptional` with one mana-plus-life decision, full-resource preflight, mana opportunities, durable pending payment, and one continuation. Decline and unsettled life payment spend no mana. Ripples of Undeath has migrated. | [20-payment](#20-payment) | None remaining |
| <a id="20-relationships"></a>**20-relationships — Stack targeting relationships** | Available | Filter spells by the permanents/players they currently target, retaining announced object identities and rechecking current control. Keep Safe has migrated. | — | None remaining |

### 21. Combat and keywords

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="21-annihilator"></a>**21-annihilator — Annihilator** | Available | Defending-player sacrifice on attack, composed from `whenever(attacks self)`, a typed `chooseCards` (chooser is the triggering defender), and `sacrifice`. It That Betrays has migrated. | [09-count](#09-count), [34-defender](#34-defender) | None remaining |
| <a id="21-even"></a>**21-even — Even-mana-value restrictions** | Available | Printed statics apply even-mana-value restrictions to opponent casting and blocking, including mana value zero. Void Winnower has migrated. | — | None remaining |
| <a id="21-fear"></a>**21-fear — Fear** | Available | Canonical keyword authoring and artifact-or-black blocker restriction. Profane Command has migrated. | — | None remaining |
| <a id="21-first-strike"></a>**21-first-strike — First strike** | Available | Canonical keyword authoring and first-strike damage steps. Sire of Seven Deaths has migrated. | — | None remaining |
| <a id="21-infect"></a>**21-infect — Infect** | Available | Canonical keyword authoring and poison/-1/-1-counter damage results. Blightsteel Colossus still needs shuffle-instead. | — | `Blightsteel Colossus` |
| <a id="21-lifelink"></a>**21-lifelink — Lifelink** | Available | Canonical keyword authoring in every damage zone, source snapshots, prevention-adjusted actual-damage life gain, and temporary grants. Mister Negative and Sire of Seven Deaths have migrated. | — | None remaining |
| <a id="21-menace"></a>**21-menace — Menace** | Available | Canonical keyword authoring and minimum-blocker requirements. Sire of Seven Deaths and Kuroki, Thief of Talents have migrated. | — | None remaining |
| <a id="21-reach"></a>**21-reach — Reach** | Available | Canonical keyword authoring and blocking legality. Sire of Seven Deaths has migrated. | — | None remaining |
| <a id="21-static"></a>**21-static — Continuous keyword grants** | Available | Filtered static keyword grants, including conditional grants; suppression/cannot-gain is a separate contract. | — | `Concordant Crossroads` |
| <a id="21-suppress"></a>**21-suppress — Keyword suppression and cannot-gain** | Available | Layer-aware removal and cannot-have-or-gain precedence for a keyword. Archetype of Endurance has migrated. | [21-static](#21-static) | None remaining |
| <a id="21-targets"></a>**21-targets — Mandatory targeting requirements** | Available | Flagbearer-style obligations while announcing targets; enforce if-able rules. Standard Bearer has migrated. | — | None remaining |
| <a id="21-tax"></a>**21-tax — Attack/block taxes** | Available | Announcement and payment of attack/block taxes, including untapped/attacking source conditions. Archangel of Tithes and Baird, Steward of Argive have migrated. | — | None remaining |
| <a id="21-ward"></a>**21-ward — Ward** | Available | Opponent targeting of spells and abilities, source/target capture, mana payment, and countering the targeted spell/ability on nonpayment. CorePlugins apply after `spells` so the ward check sees the spell on the stack. Separate rows extend the payment kind. | [20-payment](#20-payment) | `Hall of Storm Giants`; `Roaming Throne` |
| <a id="21-ward-life"></a>**21-ward-life — Life-payment ward** | Available | Extend ward to mandatory-or-counter life payment; preserve legal life-payment boundaries. Sire of Seven Deaths has migrated. | [21-ward](#21-ward) | None remaining |
| <a id="21-ward-sacrifice"></a>**21-ward-sacrifice — Sacrifice-payment ward** | Available | Extend ward to a chosen set of permanents as payment; require the full cost or counter the targeted item. Valgavoth has migrated with 26-exile. | [21-ward](#21-ward) | None remaining |

### 22. Continuous characteristics and attachments

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="22-ability-loss"></a>**22-ability-loss — Ability loss and type/base-stat changes** | Available | Canonical removeAbilities and independent setStats effects preserve unrelated types and counters, use layer-7 ordering, and restore on expiry. Curious Colossus has migrated. | — | None remaining |
| <a id="22-aura"></a>**22-aura — Typed Aura spell attachment** | Available | Typed enchant selectors, targeted Aura spell entry with attachment identity, legality checks, host references, and chosen-color entry composition. Broader noncast entry/equipment/attachment continuous effects remain in 22-attachment. | — | None remaining |
| <a id="22-attachment"></a>**22-attachment — Attachment references and Aura rules** | Available | Typed object/player enchant restrictions, pre-entry noncast attachment choices, pinned object hosts, enchanted-player references, and attachment-dependent static effects. Colossification and Tenuous Truce have migrated. | — | None remaining |
| <a id="22-changeling"></a>**22-changeling — All creature types** | Available | Changeling applies in every zone; typed additive characteristics grant every CR 205.3m creature type without granting land types. Masked Vandal and Maskwood Nexus have migrated. | — | `Firdoch Core` |
| <a id="22-characteristics"></a>**22-characteristics — Continuous characteristic definitions** | Available | Live characteristic-defining P/T applies across zones in layer 7a; conditional animation composes additive types with per-subject layer-7b setters. Room changes refresh before state-based actions. Lumra and Starfield of Nyx have migrated. | — | None remaining |
| <a id="22-choose-type"></a>**22-choose-type — Choose a creature type** | Available | Non-target resolution and entry choices offer the complete CR creature-type list, persist through restore, and feed filters or source-stored choices. Kindred Dominance, Raise the Palisade, and Cavern of Souls have migrated. | — | `Roaming Throne` |
| <a id="22-grants"></a>**22-grants — Grant activated ability programs** | Available | Canonical instruction-based activated programs are granted to recipient permanents, with separate source identity, lexical captures, activation costs, mana classification, and duration. Modal generated activations are outside this slice. Rain of Filth has migrated. | — | None remaining |
| <a id="22-land-types"></a>**22-land-types — Land-type overlays** | Available | Layer-aware addition of basic land types and the intrinsic mana abilities they confer. Blanket of Night, Urborg, Tomb of Yawgmoth, and Yavimaya, Cradle of Growth have migrated. | — | None remaining |
| <a id="22-types"></a>**22-types — Additive type/subtype changes** | Available | Canonical additive type/subtype effects retain existing characteristics and revert or expire independently. Portal to Phyrexia has migrated. | — | None remaining |

### 23. Mana provenance

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="23-mana"></a>**23-mana — Restricted mana and counterability** | Available | Typed spending restrictions, producer provenance, and qualifying-spell uncounterability. Cavern of Souls and Delighted Halfling have migrated. | [20-counterability](#20-counterability) | None remaining |

### 24. Animation and crew

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="24-animation"></a>**24-animation — Temporary animation** | Available | Canonical composition retains existing types, applies base stats before creature status, sets color/subtype and temporary ward, and locks nonzero X at announcement. Cleanup, source identity, restore, and layered ward instances have mechanic coverage. | — | — |
| <a id="24-crew"></a>**24-crew — Crew costs** | Available | Canonical crew costs tap distinct other untapped creatures with sufficient signed total power before the ability reaches the stack. Summoning sickness does not prevent paying; animation resolves separately and expires at cleanup. | [24-animation](#24-animation) | — |

### 25. Casting costs and alternate casting

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="25-alternative"></a>**25-alternative — Conditional alternative life payment** | Available | Conditional alternative life payments use the same announcement plan as normal mana, retain mandatory additional payments, reject insufficient total life, and emit payment rather than damage. | — | `Snuff Out` |
| <a id="25-cleave"></a>**25-cleave — Cleave** | Available | An ordinary alternative payment removes a conditional stack-target restriction at announcement; the paid receipt preserves eligibility during resolution. | [20-origin](#20-origin) | — |
| <a id="25-convoke"></a>**25-convoke — Convoke** | Available | Canonical convoke contributes creature taps after the shared total cost locks, preserving colored requirements, summoning-sickness eligibility, mana-spent provenance, and exclusion from simultaneous mana activations. | — | — |
| <a id="25-delve"></a>**25-delve — Delve** | Available | Exile chosen graveyard cards during payment to cover generic mana only; preserve colored requirements, reductions, and restore. | — | None remaining |
| <a id="25-embalm"></a>**25-embalm — Embalm** | Available | Sorcery-speed graveyard activation pays source exile before resolution; source LKI produces a white Zombie token copy with no mana cost. Angel of Sanctions migrated. | [28-modifiers](#28-modifiers) | None remaining |
| <a id="25-escape"></a>**25-escape — Escape** | Available | A graveyard-active `escape` static synthesizes the alternate mana plus exile-other-cards cost. Cling to Dust has migrated. | [26-graveyard-spells](#26-graveyard-spells) | None remaining |
| <a id="25-evidence"></a>**25-evidence — Collect evidence** | Available | Separately select graveyard cards for each mana-value threshold, validate disjoint payments atomically, and preserve optional paid-cost receipts through planned payment, restore, and live actions. Analyze the Pollen has migrated. | — | None remaining |
| <a id="25-evoke"></a>**25-evoke — Evoke** | Available | An ordinary alternative payment persists through battlefield entry and enables a separately stacked sacrifice trigger; later uncast entry does not reuse the receipt. | — | — |
| <a id="25-flashback"></a>**25-flashback — Flashback** | Available | A graveyard-active `flashback` static synthesizes the alternate graveyard cast, including optional sacrifice, and the exile-after-use replacement. Dread Return has migrated. | [26-graveyard-spells](#26-graveyard-spells) | None remaining |
| <a id="25-foretell"></a>**25-foretell — Foretell** | Available | Own-turn priority special action pays two, privately exiles the card, and permits its foretell cost on a later turn. Glorious Protector migrated. | [26-exile-play](#26-exile-play) | None remaining |
| <a id="25-gift"></a>**25-gift — Gift** | Available | Optional non-target player costs share announcement validation and durable paid-cost receipts. The chosen opponent receives ordinary DSL resolution effects before the remaining instructions; countering prevents the benefit. Parting Gust composes tapped blue token creation and conditional delayed owner return. | [15-player](#15-player) | `Perch Protection` |
| <a id="25-kicker"></a>**25-kicker — Kicker** | Available | Optional costs share the normal announcement/payment transaction, retain paid selections, expand target eligibility before payment, and drive resolution branches. | — | — |
| <a id="25-modal"></a>**25-modal — Conditional mode counts** | Available | Spell mode bounds evaluate announcement-time conditions, allow choosing one or both when eligible, and pin the selected count through restore and later commander departure. | [15-commander](#15-commander) | — |
| <a id="25-plot"></a>**25-plot — Plot** | Available | Sorcery-speed special action pays the plot cost and binds public exile identity; later-turn casts are sorcery-speed and omit printed mana. Pitiless Carnage migrated. | [26-exile-play](#26-exile-play), [20-origin](#20-origin) | None remaining |
| <a id="25-reductions"></a>**25-reductions — Conditional spell-cost reductions** | Available | Generic reductions evaluate declared target characteristics, graveyard card-type diversity (including Kindred), or quantified opponent board conditions before total cost locks. Ordinary, alternative, and additional costs share the same calculation. | — | — |
| <a id="25-spree"></a>**25-spree — Spree** | Available | One-or-more bounded optional payments determine target cardinalities before payment and independently gate printed-order programs. Shared live characteristic ranking preserves ties and negative power. | — | — |
| <a id="25-suspend"></a>**25-suspend — Suspend** | Available | Paid special-action exile with time counters; separately counterable upkeep and last-counter programs offer optional free casting, retain additional costs, and grant creature haste until control changes. Hypergenesis migrated. | [13-step](#13-step), [26-exile-play](#26-exile-play) | None remaining |
| <a id="25-warp"></a>**25-warp — Warp** | Available | Alternate hand cost creates an identity-bound delayed exile during permanent resolution, independently of later ability loss; only successful exile grants its owner later-turn casting. All-Fates Stalker migrated. | [26-exile-play](#26-exile-play), [20-origin](#20-origin), [13-step](#13-step) | None remaining |
| <a id="25-multikicker"></a>**25-multikicker — Multikicker** | Available | Declared repeatable optional costs retain their paid count through restore and stack-to-battlefield entry replacements; counters drive ordinary canonical mana abilities. | [25-kicker](#25-kicker) | — |

### 26. Zone play permissions

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="26-exile"></a>**26-exile — Replacement-linked exile permission** | Available | `redirectEvent('exile', { link: true })` stamps the replacement with the source identity, then `playLands` / `castSpells` with `exiledWith` and `lifeEqualManaValue` authorize play while that source remains. Valgavoth has migrated. | [26-exile-play](#26-exile-play), [18-links](#18-links) | None remaining |
| <a id="26-exile-play"></a>**26-exile-play — Play/cast from authorized exile** | Available | One-shot `offerCast` records object identity, later-turn availability, printed vs free cost, and optional as-though-flash. Static `playLands` / `castSpells` authorize live exile (and other zones) with ordinary land limits or printed/alternate spell costs. Warp, foretell, plot, and suspend consumers migrated with family 25. | [26-permission](#26-permission) | None remaining |
| <a id="26-graveyard-lands"></a>**26-graveyard-lands — Land play from graveyard** | Available | Live canonical playLands selectors authorize graveyard lands through ordinary timing and limits; source departure or ability loss revokes permission. | — | None remaining |
| <a id="26-graveyard-replacement"></a>**26-graveyard-replacement — Temporary graveyard-to-exile replacement** | Available | Resolved `createRuleEffect` move replacements retain their controller and captured source independently of source departure, ability loss, or door locks until cleanup. Live ownership/card filters exclude tokens and spell copies. Walk-In Closet // Forgotten Cellar migrated. | — | None remaining |
| <a id="26-graveyard-spells"></a>**26-graveyard-spells — Spell casting from graveyard** | Available | Static `castSpells` with printed cost authorizes announcement from graveyard through ordinary timing, alternate/additional costs, and resulting-zone policies. Six has migrated with retrace; Dread Return and Cling to Dust have migrated with flashback and escape. Resolved `createRuleEffect` grants also authorize repeated live-zone casts until cleanup independently of the source; Forgotten Cellar migrated. | [26-permission](#26-permission) | None remaining |
| <a id="26-hand"></a>**26-hand — Cast from an offered hand** | Available | Optional/free casting during resolution from a private hand, with full announcement, decline, restore, and continuation. Rishkar's Expertise and Kuroki, Thief of Talents have migrated. | [26-permission](#26-permission) | None remaining |
| <a id="26-library-lands"></a>**26-library-lands — Land play from library top** | Available | Canonical topOnly land permissions re-evaluate actual library order and retain ordinary timing and limits. | [26-top](#26-top) | — |
| <a id="26-permission"></a>**26-permission — Zone-permission infrastructure** | Available | Land permissions use source-scoped selectors. Temporary spell-cast permissions record identity (specific object or live zone), without-paying-mana cost, as-though-flash, remaining uses, and optional steal-control/inspect, then integrate with canonical announcement and decline. | — | `Ephemerate`; `Quantum Misalignment` |
| <a id="26-retrace"></a>**26-retrace — Retrace** | Available | `castSpells` with `discardLand` synthesizes the additional land-discard alternate during the controller's turn, keeping printed mana and excluding non-permanents. Six has migrated. | [26-graveyard-spells](#26-graveyard-spells) | None remaining |
| <a id="26-top"></a>**26-top — Public top-card visibility** | Available | Canonical revealLibraryTop exposes each live top card across moves, shuffles, and individual draws, including multi-draw actions. | — | — |

### 27. Multi-player hand placement

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="27-place"></a>**27-place — APNAP optional hand placement** | Available | `chooseCardsForEachPlayer` collects one optional qualifying hand card per player with private candidates, then a shared `move` puts the chosen cards onto the battlefield together. Show and Tell has migrated. | [15-each](#15-each) | None remaining |
| <a id="27-repeat"></a>**27-repeat — Repeat placement rounds** | Available | `repeatWhile` around `forEachPlayer` plus `bindMax` puts one permanent per seat, then repeats until a full round moves nothing. Eureka has migrated. | [27-place](#27-place) | None remaining |

### 28. Copy and control effects

Complete: rebound keywords exile a hand-cast non-copy spell on resolution and offer a free next-upkeep cast; demonstrate opens optional stack copies with a separate opponent copy; clone-as-entry is a `copyAsEntry` replacement in CR 616.1c with extra counters or retained abilities; legend-rule exemption is a printed static; control exchange snapshots both creature sets then grants haste and untaps; temporary copies apply `copy` effects until cleanup or permanently and restore original copiable values. Tests belong to `copyAsEntry.test.ts`, `exchangeControl.test.ts`, `copyOnto.test.ts`, `legendRuleOff.test.ts`, and `rebound.test.ts`; named catalog checks remain structural. Each migrated card embeds its cached Scryfall response with Oracle text verified on 2026-10-24.

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="28-demonstrate"></a>**28-demonstrate — Demonstrate** | Available | Optional spell copy plus an opponent's copy during the cast trigger, with separate controllers/targets. Incarnation Technique migrated. | [15-player](#15-player), [20-origin](#20-origin) | None remaining |
| <a id="28-entry"></a>**28-entry — Copy as an entry replacement** | Available | Optional clone-as-entry with extra counters or retained abilities. Spark Double and Sakashima of a Thousand Faces migrated. | [28-modifiers](#28-modifiers) | None remaining |
| <a id="28-exchange"></a>**28-exchange — Temporary control exchange** | Available | Exchange captured permanent sets, grant haste, and expire independently of source lifetime. Reins of Power migrated. | — | None remaining |
| <a id="28-legend"></a>**28-legend — Legend-rule exceptions and deck keywords** | Available | Continuous legend-rule exemption and partner keyword. Sakashima of a Thousand Faces migrated. | — | None remaining |
| <a id="28-modifiers"></a>**28-modifiers — Copy exceptions** | Available | Canonical `copy` exceptions apply after copiable values: not-legendary, added keywords/types/subtypes, replacement colors, and removed mana costs. Irenicus's Vile Duplication has migrated. | [07](#07) | None remaining |
| <a id="28-rebound"></a>**28-rebound — Rebound** | Available | Hand-cast provenance, resolving exile, and optional free cast at the next upkeep. Ephemerate and Quantum Misalignment migrated. | [20-origin](#20-origin), [13-step](#13-step), [26-exile-play](#26-exile-play) | None remaining |
| <a id="28-temporary"></a>**28-temporary — Temporary copy effects** | Available | Copy onto existing permanents for a duration and correctly restore/re-layer characteristics. Mirrorweave, Nanogene Conversion, and Thespian's Stage migrated. | [28-modifiers](#28-modifiers) | None remaining |

### 29. Ability copies and trigger multiplication

Complete: ability copies retain the original source, X/modes/payment choices and independent target bindings without activating or paying again. Nonmana activation occurrences are captured only after announcement commits. Static trigger modifiers add instances of the original qualifying trigger; they do not multiply each other, delayed triggers, or explicit once-per-turn limits. Entry causes filter the entering permanent independently of trigger-source controller; chosen-type modifiers apply to other matching creatures across all trigger kinds, with pre-event lookback for departures. Tests belong to `copySpell.test.ts`, `activationOccurrences.test.ts`, and `triggerMultiplication.test.ts`; named catalog checks remain structural. Each migrated card embeds its cached Scryfall response with Oracle text verified on 2026-10-24.

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="29-activation"></a>**29-activation — Ability activation occurrence** | Available | Observe an activated ability being activated, including paid optional copy triggers. | [29-copy](#29-copy) | `Rings of Brighthearth` |
| <a id="29-copy"></a>**29-copy — Copy a stack ability** | Available | Copy activated/triggered abilities with retargeting; exclude mana abilities where specified. | — | `Rings of Brighthearth`; `Vantress Visions`; `Virtue of Knowledge` |
| <a id="29-multiply"></a>**29-multiply — Trigger multiplication** | Available | Duplicate qualifying triggers from entering objects or chosen creature types without multiplying the underlying event. | — | `Ancient Greenwarden`; `Roaming Throne`; `Vantress Visions`; `Virtue of Knowledge`; `Yarok, the Desecrated` |

### 30. Alternative return mechanics

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="30-persist"></a>**30-persist — Persist** | Available | Dies trigger with last-known counters; return the correct graveyard identity with a -1/-1 counter. Woodfall Primus has migrated. | — | None remaining |
| <a id="30-return-result"></a>**30-return-result — Return-success-dependent follow-up** | Available | Capture power before exile; bind returned identities after replacement and use current toughness only when a return succeeds. Vanish into Memory has migrated. | [07](#07) | None remaining |
| <a id="30-unearth"></a>**30-unearth — Unearth** | Available | Sorcery-speed graveyard activation, haste, a one-shot end-step exile, and an incarnation-bound departure replacement that survives ability loss and leaves ordinary exile/blink unchanged. Kederekt Leviathan has migrated. | [13-step](#13-step), [26-permission](#26-permission) | None remaining |

### 31. Relational searches

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="31-flash"></a>**31-flash — Ability predicates for library selection** | Available | Filter for cards with flash and other rule-granted ability predicates, not only Oracle text. Waterlogged Teachings // Inundated Archive has migrated. | — | None remaining |
| <a id="31-multizone"></a>**31-multizone — Multi-zone search** | Available | Search library and/or graveyard as one optional program; shuffle only when the library was searched. Finale of Devastation has migrated. | [02](#02) | None remaining |
| <a id="31-related"></a>**31-related — Relationships between selected cards** | Available | Selected basics must share a land type; preserve reveal, fail-to-find, and shuffle semantics. Myriad Landscape has migrated. | — | None remaining |

### 32. Loyalty and emblems

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="32-emblems"></a>**32-emblems — Emblems** | Available | Source-independent command-zone programs with ongoing abilities. Teferi, Who Slows the Sunset has migrated. | [32-loyalty](#32-loyalty) | None remaining |
| <a id="32-loyalty"></a>**32-loyalty — Loyalty activation** | Available | Loyalty costs including X, once-per-turn use, timing, and full announcement validation. Jace, Multiverse Architect, Teferi, Who Slows the Sunset, and Ugin, the Spirit Dragon have migrated. | — | None remaining |

### 33. Simultaneous discard/draw

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="33-discard"></a>**33-discard — Actual per-player discard totals** | Available | Discard hands with correct shared checkpoints; retain each player's actual count and compute their maximum. Windfall has migrated. | [15-each](#15-each), [14-result-max](#14-result-max) | None remaining |

### 34. Damage and combat occurrences

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="34-damage"></a>**34-damage — Damage/enrage occurrences** | Available | `dealtDamage` occurrences bind recipient, source, amount, optional combat, and optional player-recipient filter. Apex Altisaur, Souls of the Faultless, and Rankle have migrated. | — | None remaining |
| <a id="34-defender"></a>**34-defender — Defending-player bindings** | Available | Attack occurrences capture `triggering.defender`; `playerAttacks` fires once per defending player. Breena, Kogla, Souls of the Faultless, and It That Betrays have migrated. | — | None remaining |
| <a id="34-history"></a>**34-history — Source-attributed damage history** | Available | `damageDealtThisTurn` reads the object ledger; `combatDamageThisTurn` reads legendary combat-to-player history. Blitzball and Grothama have migrated. | [34-damage](#34-damage) | None remaining |

### 35. Event history and grouped occurrences

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="35-group"></a>**35-group — Grouped zone-change occurrences** | Available | One-or-more simultaneous library/graveyard moves are one `moved` occurrence with captured identities. `firstMatchingEachTurn` on land-to-graveyard groups reads the turn's game history (CR 603.2). Crawling Sensation and It That Betrays have migrated. | — | `Hedge Shredder` |
| <a id="35-life"></a>**35-life — Life-gain occurrences** | Available | `gainedLife` captures player and actual gain amount, with turn and relationship filters. Niv-Mizzet, Ghost Counsel and Wedding Ring have migrated. | — | None remaining |
| <a id="35-ordinal"></a>**35-ordinal — Per-turn event ordinals** | Available | First/second cast, draw, or grouped zone-change event; spell casts use `SPELLS_CAST_THIS_TURN`. Crawling Sensation, Lotho, and Zimone and Dina have migrated. | — | None remaining |
| <a id="35-provenance"></a>**35-provenance — Was-cast and turn provenance** | Available | `enters.fromSpell` matches stack-to-battlefield entries; draw/life-gain `duringOwnTurn` filters the active player. Wedding Ring has migrated. | [20-origin](#20-origin) | None remaining |
| <a id="35-repeat"></a>**35-repeat — Conditionally repeat a program once** | Available | `repeatOnceIf` runs its body once, then once more only if the current condition holds, rebinding locals. Zimone and Dina have migrated. | — | None remaining |
| <a id="35-token"></a>**35-token — Token creation/sacrifice occurrences** | Available | Typed tokenCreated events retain creation snapshots; canonical tokenCreated/sacrificed patterns preserve controller/token filters and one trigger per token. Exclude resolving permanent spell copies, prevented actions, and nonsacrifice departures. Mirkwood Bats has migrated with flying and untargeted opponent drains. | — | None remaining |

### 36. Optional exile on resolution

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="36-exile"></a>**36-exile — Optional resolution exile cost** | Available | Choose zero or one eligible graveyard card after target announcement with typed selectCards; perform exile and continue only when the optional cost is paid. CR 118.11–118.12 preserves payment through replacement effects, rather than requiring the card to reach exile. Preserve decline, empty candidate sets, target revalidation, and restored choices. | — | None remaining |

### 37. Player sacrifice and modal triggers

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="37-modes"></a>**37-modes — Any-number triggered modes** | Available | Choose any allowed subset of modes when putting a triggered ability on the stack, including zero where printed. Rankle, Master of Pranks has migrated. | — | None remaining |
| <a id="37-sacrifice"></a>**37-sacrifice — Per-player sacrifice requests** | Available | Ask each affected player to choose the required permanents, choosing all available when insufficient. Portal to Phyrexia and Rankle have migrated. | [15-each](#15-each) | None remaining |

### 38. Random object choice and repetition

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="38-random"></a>**38-random — Random identity-bound object selection** | Available | Persist authoritative randomness and bind the chosen graveyard identity for copying/conditional repetition. | [07](#07) | None remaining |
| <a id="38-tapped"></a>**38-tapped — Tapped copy tokens** | Available | Create a copiable token snapshot already tapped, before entry triggers observe it. | [07](#07) | None remaining |
| <a id="38-repeat"></a>**38-repeat — Repeat while the result qualifies** | Available | Repeat a program while its latest result satisfies a predicate; handle an exhausted input set and persist each random result. This differs from Zimone's repeat-once rule. | — | None remaining |
| <a id="38-token-refs"></a>**38-token-refs — Created-token identity bindings** | Available | Bind newly created token identities for subsequent instructions, including counters placed after creation; do not pick all similar tokens by name. | — | None remaining |

### 39. Piles and voting

Complete: secret ballots stay private until the full vote finishes; object ballots pin offered identities and bind every voted object with its tally. Scoped vote modifiers capture their chooser, additional ballots, and expiration independently of their source; the most recently resolved controller wins. Finished-vote occurrences capture full ballots, allowing one opponent to count as both agreeing and disagreeing when they cast multiple votes. Círdan completes all APNAP draws before sequential optional permanent placements. Private partition/pile instructions preserve per-seat knowledge, empty piles, exile identities, and restore; spectators see only publicly revealed identities. Fortune’s Favor, Hostile Negotiations, Círdan the Shipwright, Erestor of the Council, Illusion of Choice, and Trap the Trespassers embed full cached Scryfall responses with Oracle text and rulings verified on 2026-10-24. Behavior coverage is owned by `vote.test.ts` and `partitionPiles.test.ts`; catalog checks remain structural.

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="39-control"></a>**39-control — Control or modify votes** | Available | Apply vote-controller/extra-vote effects with their own duration and player scope. | [39-vote](#39-vote) | None remaining |
| <a id="39-finished"></a>**39-finished — Finished-voting occurrence** | Available | Expose recorded per-player ballots when a vote finishes so triggered programs can compare choices and count opponents. | [39-vote](#39-vote) | None remaining |
| <a id="39-hidden"></a>**39-hidden — Face-down pile visibility** | Available | Per-seat knowledge of face-up/face-down piles through choices and restore; do not leak concealed identities. | [39-piles](#39-piles) | None remaining |
| <a id="39-object"></a>**39-object — Object ballots** | Available | Vote for eligible object identities, then aggregate votes per object; combine with secret visibility when printed. | [39-vote](#39-vote) | None remaining |
| <a id="39-piles"></a>**39-piles — Pile division and opponent choices** | Available | Typed pile partition, opponent selection, choosing a pile, and identity-bound result routing. | [08](#08), [15-player](#15-player) | None remaining |
| <a id="39-secret"></a>**39-secret — Secret council** | Available | Private votes until reveal, per-player results, ties, and restore. | [39-vote](#39-vote) | None remaining |
| <a id="39-vote"></a>**39-vote — Public voting** | Available | Typed sequential public votes, player choices, recorded ballots, totals/ties, and result-dependent continuation. | [15-each](#15-each) | None remaining |
| <a id="39-exile"></a>**39-exile — Exile the resolving spell** | Available | `exileThisSpell` moves only the current resolving spell's pinned stack incarnation, retains the resolution cursor through later choices/restore, leaves ability source permanents alone, and lets exiled spell copies cease to exist. Sail into the West has migrated with 15-simultaneous. | — | None remaining |

### 40. Sagas

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="40-saga"></a>**40-saga — Lore and chapter scheduling** | Available | Entry/precombat-main lore counters, chapter triggers, and sacrifice after the final chapter. Summon: Leviathan has migrated. | [13-step](#13-step) | None remaining |
| <a id="40-skip"></a>**40-skip — Skip the next untap** | Available | Duration-bound restrictions that consume the correct next untap event. | — | None remaining |

### 41. Encore and bestow

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="41-bestow"></a>**41-bestow — Bestow** | Available | Alternate Aura casting and attachment/creature transitions; keep attached-copy landfall branching. Springheart Nantuko has migrated. | [22-attachment](#22-attachment) | None remaining |
| <a id="41-encore"></a>**41-encore — Encore** | Available | Shared graveyard source-exile payment and last-known copying create one token per current opponent. Permanent haste grants, cleanup-bounded player attack requirements, and collected object identities compose one counterable end-step sacrifice that only affects copies still controlled by the activator. Belonging and Soul of Eternity migrated. | [28-modifiers](#28-modifiers), [34-defender](#34-defender), [13-step](#13-step) | None remaining |

### 42. Replacement, player restrictions, and protection

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="42-conditional"></a>**42-conditional — Conditional draw/life replacement** | Available | Canonical gainLife replacement patterns and amount transforms compose with live hand/life conditions. Recheck each individual draw and successive life gain; preserve affected-player ordering and restore. Structural draw splitting applies again when a replacement introduces a new multi-draw batch. Phial of Galadriel has migrated with both replacements and tap mana. | — | None remaining |
| <a id="42-player"></a>**42-player — Player life, targeting, and game-result restrictions** | Open | Player hexproof/protection, cannot-lose/change-life, and cannot-win/lose-game with explicit durations. | — | `Everybody Lives!`; `Perch Protection` |
| <a id="42-regeneration"></a>**42-regeneration — Cannot-regenerate destruction** | Open | Express and enforce a no-regeneration destruction constraint; check the engine's regeneration support before migration. | — | `Snuff Out` |
| <a id="42-shuffle"></a>**42-shuffle — Reveal-and-shuffle graveyard replacement** | Available | Replace a graveyard move with reveal and shuffle of the specific card, including from nonbattlefield zones. Tokens and cards already in a graveyard are skipped. Blightsteel Colossus and Darksteel Colossus have migrated. | — | None remaining |
| <a id="42-turn"></a>**42-turn — Extra turns** | Open | Schedule the gift recipient's extra turn in the correct order. | [25-gift](#25-gift) | `Perch Protection` |
| <a id="42-world"></a>**42-world — World rule** | Open | State-based world-supertype uniqueness, preserving how long each permanent has had the supertype and handling ties. | — | `Concordant Crossroads` |

### 43. Rooms and Adventures

| Mechanic ID | Status | Reusable contract | Prerequisites | Known dependent registrations |
| --- | --- | --- | --- | --- |
| <a id="43-adventure"></a>**43-adventure — Adventure faces and permission** | Available | Resolve the Adventure face into exile as adventured, then allow the permanent face: cast it, or play it when that face is a land. Zanarkand has migrated. | [20-origin](#20-origin) | `Vantress Visions`; `Virtue of Knowledge` |
| <a id="43-room"></a>**43-room — Room doors** | Available | Both door programs, casting/lock/unlock costs, sorcery timing, and unlock occurrences. Marina Vendrell has migrated. | — | None remaining |

### 44. Retired package bucket

No new mechanic lives in this former package bucket. See Incarnation Technique and Nezahal, Primal Tide in the [card dependency list](CARD-MIGRATION-DEPENDENCIES.md).

## Maintenance and validation

Keep mechanic IDs stable. When splitting a contract, add narrower IDs and update every affected card and prerequisite edge. Do not mark a parent contract available after implementing only one variant. Move a migrated card out of the dependency list only after removing its legacy registration; aliases remain separate rows until all exact keys are removed.

Before committing a plan update, verify that:

- Every remaining coverage-ledger `cardRegistrations[].card` appears exactly once in the card dependency table, with no unknown or missing registration keys.
- Every referenced mechanic exists, every prerequisite graph is acyclic, and the reverse dependent lists include transitive requirements.
- Card readiness is derived from **all** prerequisite statuses; source-review flags remain explicit. Same-physical-card aliases reference the full shared program.
- Counts reflect exact legacy keys and mechanic entries, not a percentage of implementation effort.

When implementing, continue the canonical authoring ratchet and test-ownership rules. Preserve open correctness reports separately from migration progress.
