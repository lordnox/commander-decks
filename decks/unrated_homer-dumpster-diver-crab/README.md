# Homer — Dumpster-Diver Crab

A Sultai self-mill combo deck that throws lands into the graveyard, drags them back onto the battlefield, and turns a suspicious number of Homers into quadratic mill.

> **Card-status note:** Scryfall lists **Homer, the Hermit** with a release date of 9 November 2026 and currently marks it not legal in Commander. The remaining 99 cards are Commander-legal.

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

1. Clone Homer so each land produces several separate mill triggers.
2. Make unrelated permanents count as seafood with changeling or type-changing effects.
3. Make each Homer trigger additional times.
4. Create several land entries at once, including on opponents' turns and directly from the graveyard.

Early Homer triggers target us. Once the graveyard contains enough lands and the battlefield contains enough Homers, the same triggers target every opponent.

The full card-by-card rationale is recorded in [DECISIONS.md](DECISIONS.md).

## The mill math

Let:

- n be the number of creature copies of Homer;
- m be the number of other permanents that count as a Crab, Lobster, Nautilus, Starfish, or Trilobite;
- L be the number of lands entering.

Without trigger doublers, each targeted player mills:

2 × L × n × (n + m)

Three Homers and **Firdoch Core** therefore mill 24 cards per land:

2 × 1 × 3 × (3 + 1) = 24

With **Roaming Throne** naming Crab, the Throne also counts as a Crab and every creature-Homer triggers twice:

2 × 1 × 3 × (3 + 2) × 2 = 60

That example includes three Homers, Firdoch Core, and Roaming Throne. Four land entries mill each opponent for 240.

**Yarok, the Desecrated**, **Ancient Greenwarden**, **Virtue of Knowledge**, and **Roaming Throne** each add another trigger rather than multiplying one another. **Strionic Resonator** copies one chosen trigger.

## How the deck works

### 1. Dive into the dumpster

Use **Mesmeric Orb**, **Perpetual Timepiece**, **Ripples of Undeath**, **Life from the Loam**, **Satyr Wayfinder**, **Millikin**, **Skull Prophet**, **Six**, and **Blossoming Tortoise** to fill the graveyard.

Homer itself is a self-mill engine. Target only yourself until the graveyard is stocked or the mill engine is ready to turn outward.

### 2. Make more Homers

The safest copies ignore the legend rule:

| Copy card | Result |
|---|---|
| **Sakashima of a Thousand Faces** | Copies Homer and disables the legend rule for the whole battlefield |
| **Spark Double** | Enters as a nonlegendary Homer |
| **Irenicus's Vile Duplication** | Creates a nonlegendary flying Homer |
| **Quantum Misalignment** | Creates one nonlegendary Homer now and another on rebound |
| **Auton Soldier** | Becomes an artifact Homer with myriad and is not legendary |
| **Helm of the Host** | Produces a new nonlegendary Homer every combat |

**Machine God's Effigy**, **Progenitor Mimic**, and Homer tokens from **Springheart Nantuko** need careful legend-rule sequencing. Use **Sakashima** or **Mirror Box**, or copy an already nonlegendary Homer such as **Spark Double**.

### 3. Inflate the seafood count

**Firdoch Core** naturally counts as seafood while also producing mana. **Roaming Throne** names Crab and becomes a Crab itself.

**Maskwood Nexus**, **Arcane Adaptation**, and **Conspiracy** turn utility creatures and tokens into seafood. This makes every mana creature, clone, and token increase the amount milled by every Homer trigger. A permanent with changeling still counts only once, not once for each of Homer's five listed types.

### 4. Multiply the triggers

| Card | What it changes |
|---|---|
| **Roaming Throne** | Adds one trigger for each other creature-Homer |
| **Yarok, the Desecrated** | Adds one trigger whenever a permanent entering caused it |
| **Ancient Greenwarden** | Adds one trigger specifically when a land entering caused it |
| **Virtue of Knowledge** | Adds one trigger whenever a permanent entering caused it |
| **Strionic Resonator** | Copies one Homer trigger already on the stack |

### 5. Launder the lands

The finishers are not limited to normal land plays:

- **Splendid Reclamation**, **Aftermath Analyst**, **Lumra, Bellow of the Woods**, and **World Shaper** return a graveyard full of lands.
- **Scapeshift** converts the existing battlefield into a fresh wave of landfall triggers.
- **Awaken the Woods** creates many land creatures simultaneously. With a type-changing effect, the new Dryads also increase Homer's seafood count before the triggers resolve.
- **Dreamscape Artist**, **Harrow**, **Entish Restoration**, and **Growth Spiral** can create landfall during an opponent's turn. **Entish Restoration** finds two basics normally or three while **Roaming Throne**, **Ancient Greenwarden**, or another creature with power 4 or greater is present.
- **Walking Atlas** and **Sakura-Tribe Scout** put a held land onto the battlefield at instant speed.
- **Ghost Town**, **Oboro, Palace in the Clouds**, the three bounce lands, **Trade Routes**, and **Meloku the Clouded Mirror** return lands to hand for reuse.
- **Patron of the Moon** converts those returned lands into repeated two-land bursts.

## Main synergy patterns

### Hedge Shredder chain

When Homer mills one or more lands from our library, **Hedge Shredder** triggers and puts those lands onto the battlefield tapped. Those lands trigger every Homer again, potentially milling more lands and continuing the chain.

This is not guaranteed to be infinite: the chain stops when a mill event finds no land. With several Homers, however, it can consume most of the library and create lethal outward-facing triggers. Keep **Perpetual Timepiece** available as the safety valve.

### Nanogene Conversion turn

Target Homer with **Nanogene Conversion**. Every other creature becomes a nonlegendary Homer until end of turn. Then:

- play the normal land for the turn;
- sacrifice a fetch land;
- cast **Harrow**, **Entish Restoration**, or **Growth Spiral**;
- resolve a graveyard-land return spell.

The converted creatures lose their former activated abilities, so activate or prepare those resources before casting the Conversion.

### Springheart cloning

Bestow **Springheart Nantuko** onto **Sakashima**, **Spark Double**, or another safely nonlegendary Homer. Each land may then create another Homer for {1}{G}. On an unsafe legendary Homer, the new token immediately invokes the legend rule unless **Mirror Box** or Sakashima's static ability is present.

### Maskwood recovery

**Maskwood Nexus**, **Arcane Adaptation**, and **Conspiracy** make creature cards in the graveyard Crabs as well. A foretold **Haunting Voyage** naming Crab can therefore return the entire creature package.

Keep Homer on the battlefield when possible: clones entering simultaneously with Homer cannot choose that entering Homer to copy. When Homer is already present, the returning clones may copy it.

### Seafood-only sweepers

With a type-changing effect in place:

- **Raise the Palisade** naming Crab returns opposing non-Crabs while leaving our creatures.
- **Kindred Dominance** naming Crab destroys opposing non-Crabs while leaving our creatures.

Without a type-changing effect, check every creature type individually before casting them.

## Win conditions

- Clone Homer two or three times, then use a mass land-return spell to mill every opponent.
- Resolve **Nanogene Conversion** followed by a burst of land entries.
- Let **Hedge Shredder** turn self-mill into a chain of recursive landfall triggers, then point later Homer triggers outward.
- Combine **Maskwood Nexus** with **Awaken the Woods** so every new land creature both triggers Homer and increases the seafood count.
- Use **Scapeshift** as a one-card landfall burst once the Homer mathematics are lethal.

There is no Laboratory Maniac or Thassa's Oracle backup. The deck wins by turning its self-mill engine against the opponents.

## Game progression

### Early game

Develop three colors and establish one of the graveyard or land-placement engines. A mana creature, **Life from the Loam**, **Mesmeric Orb**, or **Perpetual Timepiece** is better than an opening hand full of clone spells.

### Mid game

Cast Homer and target yourself. Establish a safe second Homer, then add either a type-changing effect or a trigger doubler. Avoid exposing every clone before a land burst is available.

### Late game

Count the exact mill before committing. Aim for two or three Homers, one multiplier, and four or more land entries. Point all lethal triggers at every opponent; Homer does not divide the mill among targets.

## Mulligan guide

Keep hands with:

- three lands, or two lands plus **Millikin**, **Skull Prophet**, or another reliable land enabler;
- green and blue access, with black available by the time Homer is cast;
- one early self-mill or land-reuse card;
- preferably one clone, protection spell, or recursive finisher.

Mulligan hands made entirely of clones and seven-mana payoffs, hands without green, or hands that cannot cast Homer on schedule.

## Land tutor priorities

| Situation | **Crop Rotation** target |
|---|---|
| Need an immediate extra landfall | A fetch land |
| Need repeatable off-turn landfall | **Ghost Town** or **Thawing Glaciers** |
| Need a reusable land in hand | **Oboro, Palace in the Clouds** |
| Need token production | **Field of the Dead** |
| Need self-mill selection | **Cephalid Coliseum** |
| Need a dredgeable land | **Dakmor Salvage** |

## Important sequencing and rules notes

- Each Homer trigger can target any number of players. Early triggers may target only us; lethal triggers may target every opponent.
- Homer's value of X is checked as each trigger resolves, so create seafood tokens before resolving the Homer triggers when possible.
- Several permanents sharing all five listed creature types still count once each.
- Additional-trigger effects from Throne, Yarok, Greenwarden, and Virtue are additive.
- **Roaming Throne** affects another creature of the chosen type. It does not double its own abilities.
- **Machine God's Effigy** copying Homer is a noncreature trigger source and remains legendary. It needs legend-rule support and is not doubled by Roaming Throne.
- **Field of the Dead** and Homer trigger from the same land. Put the Field trigger above the Homer triggers so its Zombie exists—and counts under a type changer—before Homer's X is calculated.
- **Perpetual Timepiece** can shuffle selected graveyard cards back before the next draw after an oversized self-mill.

## Weaknesses and priorities

Graveyard exile attacks both setup and the land-return finish. Commander removal reduces the deck quadratically, while enchantment and artifact removal can turn utility creatures back into non-seafood at the worst moment.

Protect Homer first, then the effect that makes the legend rule safe. Do not deploy **Progenitor Mimic**, unsafe Nantuko copies, or **Machine God's Effigy** as Homer without checking the legend rule.
