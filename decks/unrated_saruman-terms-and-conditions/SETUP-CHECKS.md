# Setup checks — initial Terms and Conditions build

> Historical test of commit `8695c582`. The equipment/reactive-mana revision removes the Forces, Evacuation, and Psychic Corrosion referenced below. These traces are not claims about the current list.

## Model and limits

This is a four-run, five-turn setup goldfish with separate resource-based stress branches, not a four-player game or a win-turn assessment. The milestone is **five available mana on an opponent's turn, an independent repeatable draw/card-access engine, and a named legal answer** by turn five. Saruman normally follows once six mana and protection can be assembled. Primary finishes are combat tokens and spell/mill-driven life loss; library depletion is a secondary finish.

Use the repository's Upgraded/Bracket 3 stress model as a construction test, not a assigned bracket: a must-answer permanent by turn five, commander removal, and an engine loss/wipe. The deck remains unrated. Draw the multiplayer turn-one card. Mulligans use the helper's London model: no free first mulligan, one bottomed card per mulligan. No tutor, future draw, or useful stolen opponent spell is assumed.

The opposing board for the clean setup model contains a Breeding Pool and Birds of Paradise; this gives Exotic Orchard blue/green and Snap a legal creature target. No other opposing resources are credited: Lotho receives no opponent-generated Treasure, Into the Story is not assumed discounted, and conditional free spells are not presumed enabled. Opposing libraries/mills are not interpreted as useful theft targets. Effects on those libraries are counted only as mill events.

Reproduction: deal all three seven-card candidates per run using `goldfish.py`, eight runs at seed 1729 and four at 2718, with the current cards.json entry order. Retain the full shuffled library rather than only the helper's five draws. The four traced cases are 1729/1 candidate 1, 1729/5 candidate 0, 2718/2 candidate 0, and 2718/4 candidate 0. Put London bottoms on the library bottom. After each fetch search, remove the chosen target and shuffle the remainder with a fresh `random.Random(seed * 100 + run + fetch_index - 1)`, with fetch_index starting at one. Extra draws consume the actual next cards. These fetch shuffles replace the helper's originally displayed post-search draws.

## Opening-hand screen

Twelve fresh starting situations were screened for keepable development using only each candidate hand: usually three/four lands with useful early action; two lands require early mana or cheap selection/engine access. Eleven have an acceptable hand by the first paid mulligan. Seed 1729/run 4 needs a second mulligan. This is a small opening-hand screen, not twelve full turn traces and not an estimate of the deck's true keep probability.

## Run 1 — seed 1729, run 1, one mulligan

Opening seven: Bloodstained Mire, Verdant Catacombs, Lotho, Corrupt Shirriff, Misdirection, Exhibition Tidecaller, Lavinia, Foil to Conspiracy. Bottom Misdirection: preserve lands, early mana, and the card-access engine. Kept six.

| Turn | Draw and legal plays | End state / held resources |
| --- | --- | --- |
| 1 | Draw Sudden Spoiling. Bloodstained Mire fetches Watery Grave, paying 1 fetch life and 2 shock life. Spend blue for Tidecaller. | Life 37; Watery Grave tapped, Tidecaller; five cards in hand. |
| 2 | Draw Commandeer after the first fetch shuffle. Verdant Catacombs fetches Scrubland, paying 1 life. Spend white/black to cast Lotho as the first spell. | Life 36; two lands, Tidecaller and Lotho; four cards. No Treasure: only one spell was cast. |
| 3 | Draw Prismatic Vista after the second shuffle. Marsh Flats fetches Tundra, paying 1 life. Cast Lavinia for three, with two white/blue hybrid pips correctly paid. | Life 35; three lands and three creatures; three cards. Lavinia cannot tap this turn. |
| 4 | Draw Into the Story after the third shuffle. Play Vista and fetch Island for 1 life; shuffle again. | Life 34; four lands. Opposing-turn capacity is six: four lands plus Lavinia's two colorless. Sudden Spoiling is payable at `{1}{B}{B}` using the two black duals; Into the Story still costs seven. |
| 5 | Draw Plains and play it. | Five lands plus Lavinia provide seven opposing-turn mana. Into the Story is payable even without an opposing seven-card graveyard. Commandeer is also payable at full cost; its pitch mode currently lacks two other blue cards in hand. |

Result: **delayed**. Mana and an answer are present, but Lavinia's repeatable Clue draw is not yet producing cards and there is no cheap first spell to make two casts sustainable. An end-step Into the Story branch pays seven, then draws Mystic Confluence, Psychic Corrosion, Vault of Champions, and Plains; Tidecaller mills ten from its cast because seven mana was actually spent. The four draws improve resources, but tapping out for that refill is a real decision. Do not count those undrawn cards as protection before committing to the branch.

## Run 2 — seed 1729, run 5, no mulligan

Opening: Arcane Signet, Monk Class, Raffine's Tower, Plains, Snap, Abolish, Exotic Orchard.

| Turn | Draw and legal plays | End state / held resources |
| --- | --- | --- |
| 1 | Draw Mystic Sanctuary. Play Raffine's Tower tapped. | Seven cards; no immediate mana. |
| 2 | Draw Talisman of Dominance. Play Plains and cast Arcane Signet for two. | Two lands plus a rock; six cards. |
| 3 | Draw Spark Double. Play Exotic Orchard. Cast Talisman of Dominance for two, then Monk Class for white/blue using the existing sources and the new rock if needed. | Three lands, two rocks, Monk Class; four cards. At most one mana remains after this development. Monk did not discount its own cast. |
| 4 | Draw Swamp and play it. In the clean window, pay `{W}{U}` for Class level 2, choose no bounce target, then `{1}{W}{U}` for level 3. | Four lands/two rocks give six mana; five spent, one left. This is an explicit development branch with no live paid protection. |
| 5 | Class exiles Psychic Corrosion at upkeep. Draw Prismatic Vista and play it; fetch basic Island and shuffle. Cast Snap targeting the opposing Birds, paying two and untapping the two lands used. Then cast Corrosion from exile as the second spell for `{1}{U}` after Monk's discount. | Five lands/two rocks, level-three Monk Class and Corrosion; five mana remains. Abolish costs three here: there is no Plains card retained in hand to discard. Spark Double still needs a legal creature/planeswalker copy target. |

Result: **successful card-access setup**, with a timing caveat. Class supplies ongoing exile access, not immediate raw draw. The turn-four tap-out is safe only under the clean model; if removal is represented, delay leveling and accept slower development. Saruman is affordable later, but casting him for six on turn five would leave insufficient paid protection.

## Run 3 — seed 2718, run 2, no mulligan

Opening: Exhibition Tidecaller, Archmage Emeritus, Talisman of Hierarchy, Mirrorweave, Island, Exotic Orchard, Raffine's Tower.

| Turn | Draw and legal plays | End state / held resources |
| --- | --- | --- |
| 1 | Draw Keep Safe. Play Island and cast Tidecaller. | One land and Tidecaller; six cards. |
| 2 | Draw Shelter. Play Exotic Orchard; it produces blue/green from the modeled Breeding Pool. Use two mana for Talisman of Hierarchy. | Two lands/rock; five cards. The Talisman gives independent white/black fixing. |
| 3 | Draw Watery Grave. Play it untapped for 2 life and cast Archmage for `{2}{U}{U}` using three lands and the Talisman. | Life 38; three lands/rock and two creatures; four cards. This is a clean-development tap-out branch. |
| 4 | Draw Swamp and play it. On an opposing end step, cast Shelter on Archmage choosing white: use Swamp for generic and Talisman for white. Archmage draws Consider; Shelter draws Arid Mesa. Cast Consider for blue as the second spell. Archmage draws Windswept Heath; surveil the actual next card, Force of Negation, keeping it, then draw it. | Four lands/rock; life 37 after one damage from the Talisman’s white activation; two blue mana remains for Keep Safe. Tidecaller has two three-card mill triggers. Six cards in hand: Mirrorweave, Tower, Keep Safe, Arid Mesa, Windswept Heath, Force of Negation. |
| 5 | Draw Flooded Strand; play the retained Tower tapped. | Five usable mana from the other four lands and Talisman, plus a sixth source ready next turn. Independent draw is active, Keep Safe is payable, and Force of Negation has a legal blue pitch option on opponents' turns. Six cards remain. |

Result: **successful**. The first instant plus a one-mana second spell draws four actual cards while leaving protection. Extra draws change the fifth-turn draw; it is Flooded Strand, not the helper's unadjusted Consider.

## Run 4 — seed 2718, run 4, no mulligan

Opening: Evacuation, Shark Typhoon, Shelter, Hallowed Fountain, Arcane Denial, Watery Grave, Taigam, Master Opportunist. Keep two lands because Taigam is castable and Shelter can draw once there is a creature; this is a riskier keep than three lands.

| Turn | Draw and legal plays | End state / held resources |
| --- | --- | --- |
| 1 | Draw Storm of Saruman. Play Hallowed Fountain tapped; no mana will be spent. | Seven cards; no unnecessary shock payment. |
| 2 | Draw Isolated Chapel. Play Chapel untapped because Fountain is a Plains. Cast Taigam for `{1}{U}`. | Two lands and Taigam; six cards. |
| 3 | Draw Wavebreak Hippocamp. Play Watery Grave untapped for 2 life, then cast Wavebreak for three. | Life 38; three lands and two engines; five cards. Wavebreak is the first spell this turn, so Taigam does not copy it. |
| 4 | Draw Windswept Heath. Play it and fetch Tundra for 1 life; shuffle. On an opposing end step, cast Shelter on Wavebreak choosing white. Wavebreak draws Bloodchief Ascension, then Shelter draws Commandeer. | Life 37; four lands/two creatures, two blue mana left for Arcane Denial; six cards. No second spell was cast, so Taigam does not trigger. |
| 5 | Draw Vault of Champions and play it untapped in the four-player model. | Five mana, active independent draw, Arcane Denial for two, and Commandeer with two other blue cards available to pitch. Six cards remain. |

Result: **successful**. The two-land keep found natural development, and the first-spell draw engine works without Saruman or forcing a second cast. Future Taigam value is not credited until a second spell is actually cast.

## Stress branches

These branches use the named resources from the traces. They are not extra full games; later recovery compares known land cards and taxed costs without crediting unspecified topdecks.

| Pressure | Evidence / result |
| --- | --- |
| Opponent casts Bolas's Citadel by turn five | Run 1 can pay seven for Commandeer with Lavinia's two generic mana; it cannot use the pitch mode before drawing more blue cards. Run 2 can pay three for Abolish. Run 3 can pitch a blue card to Force of Negation on the opposing turn. Run 4 can Arcane Denial for two or pitch two blue cards to Commandeer. Four legal answers, with very different resource costs. |
| Swords to Plowshares targets the draw creature | Run 3's Shelter/Keep Safe can protect Archmage when mana is held; Run 4's Shelter can protect Wavebreak while drawing two. Run 1 has no cheap protection for Lavinia at its initial deployment and must accept losing that engine. Preserve the remaining shell rather than assume Commandeer can be pitched. |
| Saruman removed after a normal six-mana cast | Run 3 can reach seven mana by its next land drop. Casting Saruman for six on our own turn leaves only one mana, and Force of Negation cannot be pitched on our turn. A Swords therefore removes him in that branch. Waiting for eight available mana permits six for Saruman plus two for Keep Safe. Archmage remains an independent engine in either case. |
| Commander removed twice | With seven current sources in the Run 3 recovery snapshot, an eight-mana recast is not yet payable. Known fetch lands can bring capacity to eight and then nine over subsequent land drops. A ten-mana second taxed recast remains unaffordable from that known resource set. Continue the independent draw shell; do not advertise immediate double-tax recovery. |
| Board wipe / engine loss | Run 3 can counter an opposing Damnation with Force of Negation; Run 4 can use Arcane Denial. In Run 2, an opposing Austere Command choosing artifacts and enchantments can remove the two rocks, Monk Class, and Corrosion: neither Snap nor Abolish protects them and no stack counter is in hand. That recovery fails immediately and must rebuild from five lands. |
| Graveyard replacement / hate | Guildmage and Ascension require cards to reach opponents' graveyards; replacement effects can blank the mill-drain burst. Gearhulk and Spelltwine also lose fuel. Heart, Typhoon, Onyx, and the independent draw engines remain functional, so do not force the graveyard line through hate. |

## Findings

- Milestone: **3/4 successful, 1/4 delayed** under the declared clean setup model. Two successful hands still choose a vulnerable development window.
- None of the four traces has a turn-five color failure after the recorded land choices. This small sample does not establish a population rate.
- Turn-five must-answer artifact: **4/4 have a named legal answer**; Run 1 pays a full seven and Run 2 pays three rather than a free mode.
- Commander removal is survivable through independent engines, but a protected six-mana cast requires extra resources. Immediate eight- and ten-mana recasts are not assumed.
- One artifact/enchantment wipe branch is a genuine weakness; one opening is mana-rich but lacks immediate repeatable draw. Neither repeats in three traced runs, so do not rebuild around a single sample.
- Broad noncreature permanent answers remain concentrated on the stack and in Abolish/temporary exile. Save them for the permanent that invalidates the shell.

These results support the intended development pattern; they do not prove a win turn, a bracket, or multiplayer strength. The next useful test is a table game that pressures enchantment engines and graveyards while measuring whether six finishing slots close after the control shell gains advantage.
