# Sefris — Dungeon Crawler Carl: Decision Log

## How to use

This file is the deck's memory. The primer is how to play the deck. This file is why the list, the primer, and the assessment look the way they do.

- **Cards in** — why each unique card is here and what job a replacement must keep doing.
- **Cards out** — why a card left and what replaced it. Read this before bringing a cut back.
- **Primer** — why a line, section, or win-turn claim is written that way.
- **Rules** — Oracle readings and stack order that were checked.
- **Talks** — dated session notes so an argument does not live only in chat.

Every unique card needs a Cards in line. The other headings appear when there is something to record.

## Goals

- **Dungeon** — Venture rooms on a clock, complete floors, and get paid for finishing them.
- **Loot** — Turn completed floors and the graveyard into permanents (reanimation, packs, dungeon tokens), not into an oops-I-win spell.

## Rankings

See `rankings.json`. 2026-09-08: jank 7, fun 8, mean 4, Dungeon 9, Loot 8.

## Cards in

This log records why every card entered the initial list. Future changes should append a dated entry identifying the card added, the card removed, and the reason.

### 2026-09-08 — Initial autobrew

### Commander and dungeon engine

- **Sefris of the Hidden Ways** — Command-zone crawl: one creature card into the graveyard each turn ventures a room; completing a dungeon returns a creature as loot.
- **Hama Pashar, Ruin Seeker** — Doubles room abilities so each venture pays twice; does not extra-venture.
- **Nadaar, Selfless Paladin** — Extra venture on enter and attack, then a completed-dungeon anthem.
- **Triumphant Adventurer** — Attack trigger ventures without needing Sefris.
- **Yuan-Ti Malison** — Connects alone to venture; backup crawler if the graveyard is quiet.
- **Midnight Pathlighter** — Combat damage ventures, and the team is blocked only by legendaries.
- **Thorough Investigation** — Attacks make Clues; sacrificing a Clue ventures.
- **Displacer Beast** — Cat that ventures on enter and can bounce itself for another room.
- **Eccentric Apprentice** — Enter venture; completed dungeon gives it flying in combat.
- **Cloister Gargoyle** — Enter venture; completed dungeon makes it a real attacker.
- **Dungeon Map** — Colorless mana plus a sorcery-speed venture.
- **Bar the Gate** — Counters a creature or planeswalker and still ventures.
- **Fates' Reversal** — Recursion plus a venture in one card.
- **Immovable Rod** — Loot item: tap to freeze a permanent, later untap to venture.
- **Radiant Solar** — Every nontoken creature enter ventures; the six-drop engine.
- **Barrowin of Clan Undurr** — Enter venture; attacks return a small creature after a floor is done.
- **Dungeon Crawler** — Namesake body that returns to hand whenever a dungeon completes.

### Initiative backup

- **White Plume Adventurer** — Takes the initiative on enter; completed dungeon untaps the team on opponents' upkeeps.
- **Seasoned Dungeoneer** — Initiative plus attack explore and protection from creatures.
- **From the Catacombs** — Reanimates from any graveyard and takes the initiative.
- **Dungeoneer's Pack** — One-shot loot: initiative, life, a card, and a Treasure.
- **Sarevok's Tome** — Initiative rock that later exiles into a spell.

### Cats (Princess Donut)

- **Nine-Lives Familiar** — Dies and comes back with revival counters; each death is a Sefris trigger if she is out.
- **Sacred Cat** — Cheap lifelink cat that dies into the yard and embalms later.
- **Whitemane Lion** — Blink that can restock a creature into hand; Lion itself hitting the yard still feeds Sefris.
- **Felidar Sovereign** — Cat closer: 40 life at upkeep, Test-of-Endurance texture.

### Graveyard fuel

- **Putrid Imp** — Repeatable discard outlet for creature cards.
- **Merfolk Looter** — Loot a creature into the yard each turn.
- **Stitcher's Supplier** — Mills creatures on enter and death.
- **Undead Butler** — Mills, then returns a creature to hand when it dies.
- **Viscera Seer** — Free sac outlet so a creature can hit the yard on demand.
- **Altar of Dementia** — Sac outlet that mills; pointed at opponents only after the board is already winning.
- **Buried Alive** — Puts three creatures in the yard (one Sefris trigger) and sets up loot.
- **Tolarian Winds** — Dumps a creature-heavy hand and draws that many.
- **Mulldrifter** — Draw; evoke puts a creature card in the yard.

### Extra recursion and finishers

- **Animate Dead** — Cheap reanimation that does not wait for a dungeon.
- **Victimize** — Two creatures back; the sacrifice is another Sefris trigger.
- **Sun Titan** — Recurs cheap permanents, including dungeon rocks and small crawlers.
- **Karmic Guide** — Enters and reanimates; echo is optional once the loot is out.
- **Gray Merchant of Asphodel** — Drain that Sefris can return after a floor.
- **Grave Titan** — Combat closer that leaves Zombies.

### Interaction and protection

- **Withering Boon** — Old black counter for a creature.
- **Unexpectedly Absent** — Uncast a problem without exile staples.
- **Chainer's Edict** — Sorcery edict with flashback.
- **Kirtar's Wrath** — Wipe that can leave Spirit tokens.
- **Rout** — Instant-speed wipe at a premium.
- **Memory Lapse** — Tempo counter, not a hard lock.
- **Nekrataal** — Enters, kills a nonartifact nonblack creature, then is loot later.
- **Mother of Runes** — On-board protection for Sefris and the cats.
- **Ephemerate** — Protects or recasts an enter-venture creature.
- **Selfless Spirit** — Board protection against a wipe.

### Ramp and draw

- **Wayfarer's Bauble** — Land onto the battlefield, not fast mana.
- **Marble Diamond** — Tapped white rock.
- **Sky Diamond** — Tapped blue rock.
- **Charcoal Diamond** — Tapped black rock.
- **Mind Stone** — Two-mana rock that can draw late.
- **Knight of the White Orchid** — Plains when behind on lands.
- **Solemn Simulacrum** — Land and a card; dies into Sefris.
- **Burnished Hart** — Sac for two basics.
- **Fact or Fiction** — Pile draw that can put creatures in the yard.
- **Deep Analysis** — Draw now or flashback later.
- **Night's Whisper** — Cheap black cards.
- **Jalum Tome** — Old activated loot draw.

### Lands

- **Command Tower** — Any color in identity.
- **Path of Ancestry** — Identity mana and a scry.
- **Exotic Orchard** — Untapped rainbow if the table cooperates.
- **Esper Panorama** — Fetches a basic.
- **Seachrome Coast** — Fast WU.
- **Darkslick Shores** — Fast UB.
- **Concealed Courtyard** — Fast WB.
- **Undercity Sewers** — Surveil land that can mill a creature.
- **Isolated Chapel** — Checkland.
- **Glacial Fortress** — Checkland.
- **Drowned Catacomb** — Checkland.
- **Caves of Koilos** — Pain dual.
- **Underground River** — Pain dual.
- **Adarkar Wastes** — Pain dual.
- **Prairie Stream** — Battle land.
- **Sunken Hollow** — Battle land.
- **Fetid Heath** — Filter.
- **High Market** — Sac outlet land.
- **Phyrexian Tower** — Sac for {B}{B}; not fast mana on the play it enters.
- **Bojuka Bog** — Grave hate on a land drop.
- **Geier Reach Sanitarium** — Shared loot.
- **Castle Locthwain** — Black draw land.
- **Ancient Den** — White artifact land.
- **Seat of the Synod** — Blue artifact land.
- **Vault of Whispers** — Black artifact land.
- **Plains** — White source.
- **Island** — Blue source.
- **Swamp** — Black source.

## Primer

### 2026-09-08 — Assessment

Bracket 2− vs target Incremental Core (2). Match: 0 Game Changers on the 2026-09-03 snapshot, telegraphed dungeon completions, no extra turns, no two-card infinite. Position is the low edge because Sefris is once per turn and goldfish traces through turn five are setup, not a close. Not Bracket 1: real edicts, wipes, and a functional reanimator plan. Not Bracket 3: no from-hand dump and no Game Changer engines.

## Cards out

### 2026-09-08 — Fast lands after goldfish

v1 traces (seeds 1729 + 2718) missed Sefris's third color or played three tapped lands in four of twelve runs.

- **Dungeon Descent** → **Seachrome Coast** — Always tapped, and the venture activation is four mana plus a legend.
- **Raffine's Tower** → **Darkslick Shores** — Always tapped triome when the commander needs untapped U or B on three.
- **Arcane Sanctum** → **Concealed Courtyard** — Same Esper tapland problem; the Courtyard is white-black when we are short a Plains.

## Rules

- Sefris ventures when one or more creature *cards* enter the graveyard from anywhere, once each turn. Tokens dying do not count. Multiple cards in one event still make one trigger.
- Completing a dungeon is a state check when you would advance from the last room. Sefris's Create Undead then targets a creature card in the graveyard. Hama Pashar copies room abilities; it does not make you complete twice.
- You choose which dungeon to enter on the first venture of a new dungeon. Lost Mine of Phandelver is the usual first floor (four rooms on a short path). Tomb of Annihilation is the short painful floor (Atropal at the end). Dungeon of the Mad Mage is the long loot floor. Initiative uses Undercity, which is a separate dungeon object.
- Acererak is not in the 99: bouncing him every turn while Tomb of Annihilation is incomplete is a free-venture engine this list does not want, and the lich is the wrong joke for Carl.
- Nine-Lives Familiar only enters with revival counters if it was *cast*. Sefris returning it from the yard does not restock the nine lives.
- Sacred Cat's embalm exiles it from the graveyard; that is not a Sefris trigger. The first death is.
- Immovable Rod ventures when it *becomes untapped*, not when you choose to leave it tapped. The freeze ability lasts while it remains tapped.
- Altar of Dementia plus a looping reanimation pair is not assembled here (no Reveillark). Milling the table is a backup clock, not a two-card infinite.

## Talks

### 2026-09-08 — Autobrew lock

Game plan: each turn put a creature card in the graveyard so Sefris ventures a dungeon room; completing a floor reanimates loot; win by attacking with that board and dungeon tokens. Backup: take the initiative and beat down if Sefris is gone.

Target: Incremental Core (Bracket 2). Normal win around turns 9–10. High roll around 7–8 if Tomb of Annihilation completes quickly and returns Grave Titan or Radiant Solar. Commander on turn 3. Turn-five milestone: Sefris in play and at least two rooms deep (or initiative started). Zero Game Changers (snapshot 2026-09-03). No extra turns. No permanent fast mana. Interaction buckets: targeted removal (edicts, Unexpectedly Absent, Nekrataal, Immovable Rod), stack (Bar the Gate, Withering Boon, Memory Lapse), wipes (Rout, Kirtar's Wrath), board protection (Mother of Runes, Selfless Spirit, Ephemerate). No life-total fog package.

Commander comparison (query `f:c is:commander (o:venture or o:initiative or o:dungeon)`):

| Candidate | Role in plan | Colours gained/lost | Better than peers | Worse than peers | If removed | Threat profile | Bracket fit |
|---|---|---|---|---|---|---|---|
| Sefris of the Hidden Ways | Starts the crawl from the zone whenever a creature hits the yard | Esper | Engine plus loot in one card | Once per turn | 99 still ventures and takes initiative | Removal magnet | Incremental Core |
| Nadaar, Selfless Paladin | Ventures on enter/attack | Mono-white | Simple attacker | No loot reanimate, no blue | Same but thinner | Medium | Core, less Carl |
| Hama Pashar, Ruin Seeker | Doubles rooms | Azorius | Pays more per room | Does not start the dungeon | 99 must venture without her | Low | Core support, not the engine |
| Barrowin of Clan Undurr | Enter venture, attack reanimate 3cmc | Orzhov | Attack loot | Four mana, no blue, small reanimate | Weaker Sefris | Medium | Core |
| Acererak the Archlich | Bounce-venture until Tomb is done | Mono-black | Free rooms | Combo reputation, not Carl | N/A | High | Wrong texture |

Sefris won because she enables the repeating action from the command zone and converts completed floors into creatures. Nadaar would have won a paladin-beatdown plan. Hama would have won a "double every room" support-commander plan. Acererak would have won a Bracket 3 lich-loop plan.

Mana budget before v1: 37 true lands, 0 modal land backs. Diamonds enter tapped; Path of Ancestry, Esper Panorama, Undercity Sewers, and Bojuka Bog always enter tapped; Prairie Stream and Sunken Hollow often do. Fast lands (Seachrome Coast, Darkslick Shores, Concealed Courtyard), painlands, checks, Orchard, Tower, High Market, artifact lands, and 12 basics are the untapped early sources. Commander is `{W}{U}{B}` on three: keep hands with two untapped lands that can make two of the three colors by turn two and the third by turn three. Curve is heavy at 2–4; Radiant Solar, Grave Titan, and Felidar Sovereign are the 5–6 spikes. No Sol Ring, no Game Changer tutors.

Packages: dungeon ventures (density ~15), initiative (5), graveyard fuel (9), extra reanimate (4), Donut cats (4 including Displacer Beast), interaction as above, 8 ramp, 4 dedicated draw plus loot engines.

House-rule cuts from the shortlist: Acererak, Sol Ring, Rhystic Study, Swords to Plowshares, Demonic Tutor, Entomb, Reveillark (two-card loop with Karmic Guide).

### 2026-09-08 — Goldfish v1 then v2

Test model: Incremental Core, Sefris on three, turn-five bar = Sefris in play and two rooms deep *or* initiative started. Horizon five. Seeds 1729 (8) and 2718 (4). London mulligan. Multiplayer draw on turn one. No opposing creatures except stress branches.

v1 (pre-fast-lands): keepable ≤1 mulligan 10/12. Milestone 8/12. Mana/colour failure 4/12 (systemic: always-tapped Esper lands). Interaction in hand 7/12. Commander-removal: one Sefris death is recoverable via Nadaar/initiative; two deaths with tax 5 is a delay, not a goldfish win. Plan successful / delayed / failed ≈ 5 / 3 / 4.

v2 after Seachrome Coast, Darkslick Shores, Concealed Courtyard (same seeds, different library order): keepable ≤1 mulligan 10/12. Milestone 9/12. Mana/colour failure 2/12 (1729 run 4 still zero lands on seven; 1729 run 2 is Island + Fetid Heath without black until Dungeon Crawler). That is below the three-run systemic bar, so the loop stops.

Stress (v2 representative):
- Clean: 1729 run 5 keep seven — Tower, Plains, Swamp, Diamond, Whisper, Hama, Barrowin. T3 Sefris, T4 Barrowin room 1, T5 Putrid discards Yuan-Ti room 2.
- Sefris removed after first cast: still have Barrowin/Hama/Nadaar in several keeps; initiative pack/Plume in others. Recovery 3/4 sampled.
- Sefris removed twice: tax 5 on five lands is possible, rooms then come from ETB venturers. Slow.
- Wipe after a floor: Selfless Spirit / Mother of Runes not always drawn (protection category 27.6% by T3). Recovery is reanimate, not recasting the team.
- Graveyard hate: blanks Create Undead and Buried Alive; ventures from Nadaar/Malison still work.

Turn five is setup, not a win. Expected win turn is not measured; the horizon does not support a turn-eight claim from these traces.
