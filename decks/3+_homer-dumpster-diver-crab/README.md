# [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) — Dumpster-Diver Crab

> Bracket 3+ graveyard-landfall combo deck. Usually threatens a win around turn seven, with strong turn-six lines and an unlikely turn-four [Hedge Shredder](https://scryfall.com/card/dsk/183/hedge-shredder?utm_source=api) chain.

A Sultai self-mill combo deck that throws lands into the graveyard, drags them back onto the battlefield, and turns a suspicious number of Homers into quadratic mill.

> **Card-status note:** Scryfall lists [**Homer, the Hermit**](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) with a release date of 9 November 2026 and currently marks it not legal in Commander. The remaining 99 cards are Commander-legal.

## Key cards

<p align="center">
  <a href="https://scryfall.com/card/mbc/40/homer-the-hermit"><img src="https://cards.scryfall.io/normal/front/d/9/d9934129-11b4-4e91-b81c-9d8e5bb14523.jpg?1787264310" width="160" alt="Homer, the Hermit"></a>
  <a href="https://scryfall.com/card/cmr/89/sakashima-of-a-thousand-faces"><img src="https://cards.scryfall.io/normal/front/7/1/714c3a1f-7b30-4ed8-8f38-6176758741fb.jpg?1783928853" width="160" alt="Sakashima of a Thousand Faces"></a>
  <a href="https://scryfall.com/card/lci/258/roaming-throne"><img src="https://cards.scryfall.io/normal/front/3/2/32fd8b7c-baf3-4d3d-be6f-044a917b11a0.jpg?1783913723" width="160" alt="Roaming Throne"></a>
  <a href="https://scryfall.com/card/clb/865/maskwood-nexus"><img src="https://cards.scryfall.io/normal/front/1/2/1246c42d-57c0-4cba-959a-15ad89d8a50b.jpg?1783922389" width="160" alt="Maskwood Nexus"></a>
  <a href="https://scryfall.com/card/dsk/183/hedge-shredder"><img src="https://cards.scryfall.io/normal/front/3/9/39e83502-2ffd-4169-94e3-116701323ed5.jpg?1783909453" width="160" alt="Hedge Shredder"></a>
  <a href="https://scryfall.com/card/eoc/108/splendid-reclamation"><img src="https://cards.scryfall.io/normal/front/6/3/63c7f172-0aec-4629-967c-37253aed0f0d.jpg?1783906030" width="160" alt="Splendid Reclamation"></a>
</p>

## Deck summary

This is not Crab typal. The deck uses four independent multipliers:

1. Clone [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) so each land produces several separate mill triggers.
2. Make unrelated permanents count as seafood with changeling or type-changing effects.
3. Make each [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) trigger additional times.
4. Create several land entries at once, including on opponents' turns and directly from the graveyard.

Early [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) triggers target us. Once the graveyard contains enough lands and the battlefield contains enough Homers, the same triggers target every opponent.

The full card-by-card rationale is recorded in [DECISIONS.md](DECISIONS.md).

## The mill math

Let:

- n be the number of creature copies of [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api);
- m be the number of other permanents that count as a Crab, Lobster, Nautilus, Starfish, or Trilobite;
- L be the number of lands entering.

Without trigger doublers, each targeted player mills:

2 × L × n × (n + m)

Three Homers and [**Firdoch Core**](https://scryfall.com/card/ecl/255/firdoch-core?utm_source=api) therefore mill 24 cards per land:

2 × 1 × 3 × (3 + 1) = 24

With [**Roaming Throne**](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api) naming Crab, the Throne also counts as a Crab and every creature-[Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) triggers twice:

2 × 1 × 3 × (3 + 2) × 2 = 60

That example includes three Homers, [Firdoch Core](https://scryfall.com/card/ecl/255/firdoch-core?utm_source=api), and [Roaming Throne](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api). Four land entries mill each opponent for 240.

[**Yarok, the Desecrated**](https://scryfall.com/card/ecc/136/yarok-the-desecrated?utm_source=api), [**Ancient Greenwarden**](https://scryfall.com/card/otc/186/ancient-greenwarden?utm_source=api), [**Virtue of Knowledge**](https://scryfall.com/card/woe/76/virtue-of-knowledge-vantress-visions?utm_source=api), and [**Roaming Throne**](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api) each add another trigger rather than multiplying one another. [**Strionic Resonator**](https://scryfall.com/card/moc/384/strionic-resonator?utm_source=api) copies one chosen trigger.

## How the deck works

### 1. Dive into the dumpster

Use [**Mesmeric Orb**](https://scryfall.com/card/2xm/272/mesmeric-orb?utm_source=api), [**Perpetual Timepiece**](https://scryfall.com/card/soc/354/perpetual-timepiece?utm_source=api), [**Ripples of Undeath**](https://scryfall.com/card/mh3/107/ripples-of-undeath?utm_source=api), [**Life from the Loam**](https://scryfall.com/card/tdc/96/life-from-the-loam?utm_source=api), [**Satyr Wayfinder**](https://scryfall.com/card/eoc/106/satyr-wayfinder?utm_source=api), [**Millikin**](https://scryfall.com/card/soc/351/millikin?utm_source=api), [**Skull Prophet**](https://scryfall.com/card/tdc/304/skull-prophet?utm_source=api), [**Six**](https://scryfall.com/card/mh3/169/six?utm_source=api), and [**Blossoming Tortoise**](https://scryfall.com/card/woe/163/blossoming-tortoise?utm_source=api) to fill the graveyard.

[Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) itself is a self-mill engine. Target only yourself until the graveyard is stocked or the mill engine is ready to turn outward.

### 2. Make more Homers

The safest copies ignore the legend rule:

| Copy card | Result |
|---|---|
| [**Sakashima of a Thousand Faces**](https://scryfall.com/card/cmr/89/sakashima-of-a-thousand-faces?utm_source=api) | Copies [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) and disables the legend rule for the whole battlefield |
| [**Spark Double**](https://scryfall.com/card/rvr/62/spark-double?utm_source=api) | Enters as a nonlegendary [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) |
| [**Irenicus's Vile Duplication**](https://scryfall.com/card/clb/78/irenicuss-vile-duplication?utm_source=api) | Creates a nonlegendary flying [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) |
| [**Quantum Misalignment**](https://scryfall.com/card/msc/152/quantum-misalignment?utm_source=api) | Creates one nonlegendary [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) now and another on rebound |
| [**Auton Soldier**](https://scryfall.com/card/who/36/auton-soldier?utm_source=api) | Becomes an artifact [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) with myriad and is not legendary |

[**Machine God's Effigy**](https://scryfall.com/card/brc/16/machine-gods-effigy?utm_source=api), [**Progenitor Mimic**](https://scryfall.com/card/2xm/212/progenitor-mimic?utm_source=api), and [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) tokens from [**Springheart Nantuko**](https://scryfall.com/card/mh3/171/springheart-nantuko?utm_source=api) need careful legend-rule sequencing. Use [**Sakashima**](https://scryfall.com/card/cmr/89/sakashima-of-a-thousand-faces?utm_source=api) or [**Mirror Box**](https://scryfall.com/card/neo/250/mirror-box?utm_source=api), or copy an already nonlegendary [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) such as [**Spark Double**](https://scryfall.com/card/rvr/62/spark-double?utm_source=api).

### 3. Inflate the seafood count

[**Firdoch Core**](https://scryfall.com/card/ecl/255/firdoch-core?utm_source=api) naturally counts as seafood while also producing mana. [**Roaming Throne**](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api) names Crab and becomes a Crab itself.

[**Maskwood Nexus**](https://scryfall.com/card/clb/865/maskwood-nexus?utm_source=api), [**Arcane Adaptation**](https://scryfall.com/card/xln/46/arcane-adaptation?utm_source=api), and [**Conspiracy**](https://scryfall.com/card/tsb/39/conspiracy?utm_source=api) turn utility creatures and tokens into seafood. This makes every mana creature, clone, and token increase the amount milled by every [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) trigger. A permanent with changeling still counts only once, not once for each of [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api)'s five listed types.

### 4. Multiply the triggers

| Card | What it changes |
|---|---|
| [**Roaming Throne**](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api) | Adds one trigger for each other creature-[Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) |
| [**Yarok, the Desecrated**](https://scryfall.com/card/ecc/136/yarok-the-desecrated?utm_source=api) | Adds one trigger whenever a permanent entering caused it |
| [**Ancient Greenwarden**](https://scryfall.com/card/otc/186/ancient-greenwarden?utm_source=api) | Adds one trigger specifically when a land entering caused it |
| [**Virtue of Knowledge**](https://scryfall.com/card/woe/76/virtue-of-knowledge-vantress-visions?utm_source=api) | Adds one trigger whenever a permanent entering caused it |
| [**Strionic Resonator**](https://scryfall.com/card/moc/384/strionic-resonator?utm_source=api) | Copies one [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) trigger already on the stack |

### 5. Launder the lands

The finishers are not limited to normal land plays:

- [**Splendid Reclamation**](https://scryfall.com/card/eoc/108/splendid-reclamation?utm_source=api), [**Aftermath Analyst**](https://scryfall.com/card/eoc/91/aftermath-analyst?utm_source=api), [**Lumra, Bellow of the Woods**](https://scryfall.com/card/blb/183/lumra-bellow-of-the-woods?utm_source=api), and [**World Shaper**](https://scryfall.com/card/otc/214/world-shaper?utm_source=api) return a graveyard full of lands.
- [**Scapeshift**](https://scryfall.com/card/m19/201/scapeshift?utm_source=api) converts the existing battlefield into a fresh wave of landfall triggers.
- [**Awaken the Woods**](https://scryfall.com/card/bro/170/awaken-the-woods?utm_source=api) creates many land creatures simultaneously. With a type-changing effect, the new Dryads also increase [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api)'s seafood count before the triggers resolve.
- [**Dreamscape Artist**](https://scryfall.com/card/tsr/64/dreamscape-artist?utm_source=api), [**Harrow**](https://scryfall.com/card/eoc/98/harrow?utm_source=api), [**Entish Restoration**](https://scryfall.com/card/ltr/163/entish-restoration?utm_source=api), and [**Growth Spiral**](https://scryfall.com/card/dsc/88/growth-spiral?utm_source=api) can create landfall during an opponent's turn. [**Entish Restoration**](https://scryfall.com/card/ltr/163/entish-restoration?utm_source=api) finds two basics normally or three while [**Roaming Throne**](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api), [**Ancient Greenwarden**](https://scryfall.com/card/otc/186/ancient-greenwarden?utm_source=api), or another creature with power 4 or greater is present.
- [**Walking Atlas**](https://scryfall.com/card/wwk/131/walking-atlas?utm_source=api) and [**Sakura-Tribe Scout**](https://scryfall.com/card/sok/144/sakura-tribe-scout?utm_source=api) put a held land onto the battlefield at instant speed.
- [**Dryad of the Ilysian Grove**](https://scryfall.com/card/cmm/891/dryad-of-the-ilysian-grove?utm_source=api) supplies an additional land play each turn, while [**Ramunap Excavator**](https://scryfall.com/card/otc/202/ramunap-excavator?utm_source=api) replays fetch lands and other utility lands from the graveyard.
- [**Ghost Town**](https://scryfall.com/card/tmp/318/ghost-town?utm_source=api), [**Oboro, Palace in the Clouds**](https://scryfall.com/card/sok/164/oboro-palace-in-the-clouds?utm_source=api), the three bounce lands, [**Trade Routes**](https://scryfall.com/card/9ed/108/trade-routes?utm_source=api), and [**Meloku the Clouded Mirror**](https://scryfall.com/card/cmr/399/meloku-the-clouded-mirror?utm_source=api) return lands to hand for reuse.
- [**Deathsprout**](https://scryfall.com/card/c20/208/deathsprout?utm_source=api) removes a creature at instant speed and puts a basic land directly onto the battlefield, turning interaction into another [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) trigger.

## Main synergy patterns

### [Hedge Shredder](https://scryfall.com/card/dsk/183/hedge-shredder?utm_source=api) chain

When [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) mills one or more lands from our library, [**Hedge Shredder**](https://scryfall.com/card/dsk/183/hedge-shredder?utm_source=api) triggers and puts those lands onto the battlefield tapped. Those lands trigger every [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) again, potentially milling more lands and continuing the chain.

This is not guaranteed to be infinite: the chain stops when a mill event finds no land. With several Homers, however, it can consume most of the library and create lethal outward-facing triggers. Keep [**Perpetual Timepiece**](https://scryfall.com/card/soc/354/perpetual-timepiece?utm_source=api) available as the safety valve.

### [Nanogene Conversion](https://scryfall.com/card/who/49/nanogene-conversion?utm_source=api) turn

Target [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) with [**Nanogene Conversion**](https://scryfall.com/card/who/49/nanogene-conversion?utm_source=api). Every other creature becomes a nonlegendary [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) until end of turn. Then:

- play the normal land for the turn;
- sacrifice a fetch land;
- cast [**Harrow**](https://scryfall.com/card/eoc/98/harrow?utm_source=api), [**Entish Restoration**](https://scryfall.com/card/ltr/163/entish-restoration?utm_source=api), or [**Growth Spiral**](https://scryfall.com/card/dsc/88/growth-spiral?utm_source=api);
- resolve a graveyard-land return spell.

The converted creatures lose their former activated abilities, so activate or prepare those resources before casting the Conversion.

### Springheart cloning

Bestow [**Springheart Nantuko**](https://scryfall.com/card/mh3/171/springheart-nantuko?utm_source=api) onto [**Sakashima**](https://scryfall.com/card/cmr/89/sakashima-of-a-thousand-faces?utm_source=api), [**Spark Double**](https://scryfall.com/card/rvr/62/spark-double?utm_source=api), or another safely nonlegendary [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api). Each land may then create another [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) for {1}{G}. On an unsafe legendary [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api), the new token immediately invokes the legend rule unless [**Mirror Box**](https://scryfall.com/card/neo/250/mirror-box?utm_source=api) or [Sakashima](https://scryfall.com/card/cmr/89/sakashima-of-a-thousand-faces?utm_source=api)'s static ability is present.

### Maskwood recovery

[**Maskwood Nexus**](https://scryfall.com/card/clb/865/maskwood-nexus?utm_source=api), [**Arcane Adaptation**](https://scryfall.com/card/xln/46/arcane-adaptation?utm_source=api), and [**Conspiracy**](https://scryfall.com/card/tsb/39/conspiracy?utm_source=api) make creature cards in the graveyard Crabs as well. A foretold [**Haunting Voyage**](https://scryfall.com/card/ecc/75/haunting-voyage?utm_source=api) naming Crab can therefore return the entire creature package.

Keep [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) on the battlefield when possible: clones entering simultaneously with [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) cannot choose that entering [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) to copy. When [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) is already present, the returning clones may copy it.

### Recovering a milled Yarok

The most efficient recovery is [**Stitch Together**](https://scryfall.com/card/c18/119/stitch-together?utm_source=api): it returns [Yarok, the Desecrated](https://scryfall.com/card/ecc/136/yarok-the-desecrated?utm_source=api) to hand before threshold and directly to the battlefield once the graveyard contains seven cards. [**Dread Return**](https://scryfall.com/card/cmm/153/dread-return?utm_source=api) and [**Victimize**](https://scryfall.com/card/tdc/198/victimize?utm_source=api) also reanimate Yarok directly; [**Haunting Voyage**](https://scryfall.com/card/ecc/75/haunting-voyage?utm_source=api) can return it by naming Elemental or Horror. [**Six**](https://scryfall.com/card/mh3/169/six?utm_source=api) and the [Forgotten Cellar](https://scryfall.com/card/dsk/205/walk-in-closet-forgotten-cellar?utm_source=api) room of [**Walk-In Closet**](https://scryfall.com/card/dsk/205/walk-in-closet-forgotten-cellar?utm_source=api) let Yarok be cast from the graveyard, while [**Bala Ged Recovery**](https://scryfall.com/card/znr/180/bala-ged-recovery-bala-ged-sanctuary?utm_source=api) returns it to hand. [**Perpetual Timepiece**](https://scryfall.com/card/soc/354/perpetual-timepiece?utm_source=api) is the emergency option: it shuffles Yarok back into the library rather than recovering it immediately.

### Seafood-only sweepers

With a type-changing effect in place:

- [**Raise the Palisade**](https://scryfall.com/card/ltc/23/raise-the-palisade?utm_source=api) naming Crab returns opposing non-Crabs while leaving our creatures.
- [**Kindred Dominance**](https://scryfall.com/card/msc/156/kindred-dominance?utm_source=api) naming Crab destroys opposing non-Crabs while leaving our creatures.

Without a type-changing effect, check every creature type individually before casting them.

## Win conditions

- Clone [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) two or three times, then use a mass land-return spell to mill every opponent.
- Resolve [**Nanogene Conversion**](https://scryfall.com/card/who/49/nanogene-conversion?utm_source=api) followed by a burst of land entries.
- Let [**Hedge Shredder**](https://scryfall.com/card/dsk/183/hedge-shredder?utm_source=api) turn self-mill into a chain of recursive landfall triggers, then point later [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) triggers outward.
- Combine [**Maskwood Nexus**](https://scryfall.com/card/clb/865/maskwood-nexus?utm_source=api) with [**Awaken the Woods**](https://scryfall.com/card/bro/170/awaken-the-woods?utm_source=api) so every new land creature both triggers [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) and increases the seafood count.
- Use [**Scapeshift**](https://scryfall.com/card/m19/201/scapeshift?utm_source=api) as a one-card landfall burst once the [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) mathematics are lethal.

There is no Laboratory Maniac or Thassa's Oracle backup. The deck wins by turning its self-mill engine against the opponents.

## Game progression

### Early game

Develop three colors and establish one of the graveyard or land-placement engines. A mana creature, [**Life from the Loam**](https://scryfall.com/card/tdc/96/life-from-the-loam?utm_source=api), [**Mesmeric Orb**](https://scryfall.com/card/2xm/272/mesmeric-orb?utm_source=api), or [**Perpetual Timepiece**](https://scryfall.com/card/soc/354/perpetual-timepiece?utm_source=api) is better than an opening hand full of clone spells.

### Mid game

Cast [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) and target yourself. Establish a safe second [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api), then add either a type-changing effect or a trigger doubler. Avoid exposing every clone before a land burst is available.

### Late game

Count the exact mill before committing. Aim for two or three Homers, one multiplier, and four or more land entries. Point all lethal triggers at every opponent; [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) does not divide the mill among targets.

## Mulligan guide

Keep hands with:

- three lands, or two lands plus [**Millikin**](https://scryfall.com/card/soc/351/millikin?utm_source=api), [**Skull Prophet**](https://scryfall.com/card/tdc/304/skull-prophet?utm_source=api), or another reliable land enabler;
- green and blue access, with black available by the time [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) is cast;
- one early self-mill or land-reuse card;
- preferably one clone, protection spell, or recursive finisher.

Mulligan hands made entirely of clones and seven-mana payoffs, hands without green, or hands that cannot cast [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) on schedule.

## Important sequencing and rules notes

- Each [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) trigger can target any number of players. Early triggers may target only us; lethal triggers may target every opponent.
- [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api)'s value of X is checked as each trigger resolves, so create seafood tokens before resolving the [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) triggers when possible.
- Several permanents sharing all five listed creature types still count once each.
- Additional-trigger effects from Throne, Yarok, Greenwarden, and Virtue are additive.
- [**Roaming Throne**](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api) affects another creature of the chosen type. It does not double its own abilities.
- [**Machine God's Effigy**](https://scryfall.com/card/brc/16/machine-gods-effigy?utm_source=api) copying [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) is a noncreature trigger source and remains legendary. It needs legend-rule support and is not doubled by [Roaming Throne](https://scryfall.com/card/lci/258/roaming-throne?utm_source=api).
- [**Perpetual Timepiece**](https://scryfall.com/card/soc/354/perpetual-timepiece?utm_source=api) can shuffle selected graveyard cards back before the next draw after an oversized self-mill.

## Weaknesses and priorities

Graveyard exile attacks both setup and the land-return finish. Commander removal reduces the deck quadratically, while enchantment and artifact removal can turn utility creatures back into non-seafood at the worst moment.

Protect [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) first, then the effect that makes the legend rule safe. Do not deploy [**Progenitor Mimic**](https://scryfall.com/card/2xm/212/progenitor-mimic?utm_source=api), unsafe Nantuko copies, or [**Machine God's Effigy**](https://scryfall.com/card/brc/16/machine-gods-effigy?utm_source=api) as [Homer](https://scryfall.com/card/mbc/40/homer-the-hermit?utm_source=api) without checking the legend rule.
