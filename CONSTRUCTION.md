# Deck construction

Deck-building **hints** for the non-mana 99: roles, densities, and a rough
order that tends to catch empty engines and empty hands. None of it is a rule.
A deck that knowingly ignores every number here can still be the right deck —
the point is to notice the trade, not to pass a checklist.

Lands, coloured sources, and tap-land timing live in [`MANABASE.md`](MANABASE.md).
What an answer slot is *for* lives in [`INTERACTION.md`](INTERACTION.md). This
file is the skeleton between those two: how the remaining slots split, and how
to count them.

Use `simulate-deck` when a density or sequencing question actually matters
enough to test.

Sources (read the [local cache](construction-sources/README.md); do not fetch
the live pages unless refreshing that cache):

- The Command Zone, [Commander Deckbuilding Template for the New Era](https://edhrec.com/articles/the-command-zone-commander-deckbuilding-template-for-the-new-era-the-command-zone-658-mtg-edh-magic-gathering)
  (ep. 658; working notes: [construction-sources/command-zone-658.md](construction-sources/command-zone-658.md))
- Rebell Lily / [commandertemplate.com](https://commandertemplate.com/),
  [The Math Behind Your Ramp and Card Draw Ratio](https://www.youtube.com/watch?v=IQVw-XCrntQ)
  and [I Built the Deck Builder Commander Actually Needs](https://www.youtube.com/watch?v=KCXWzqCErqE)
  (working notes: [construction-sources/commandertemplate.md](construction-sources/commandertemplate.md))
- Community 8×8 / cube-style theme packages (working notes:
  [construction-sources/eight-by-eight.md](construction-sources/eight-by-eight.md))

Snapshot **2026-09-14**. These models disagree with each other and with
Karsten in `MANABASE.md`. Treat a mismatch as a second look, not a veto.

## How to count

- Categorize a card by **why it is in the 99**, same rule as interaction.
  Pick a **floor** job and count that slot there. A ramp spell that also
  draws is still one card.
- Overlap is real. Command Zone's template numbers add up to more than 99
  on purpose. Do not double-book Sol Ring as a land and as ramp.
- Commander-dependent mana, draw, or interaction is synergy until the
  commander is in play. Ask whether the card still does the floor job if
  the commander is taxed twice.
- Tutors find a card; they are not card advantage. Cantrips replace
  themselves; they are not a draw engine. Impulse (exile and play) is
  selection. Combat-damage draw is unreliable at a four-player table.
- Incidental "this creature blocks well" is not interaction. Incidental
  "this land taps for two" is not ramp.

## A rough order

### 1. Pin the operational threshold

The turn or mana value when the deck actually starts doing the thing.
Usually the commander's mana value. Raise it when the commander is cheap
but the plan is late (Isamaru control). Lower it when dorks or rituals
make a high-cost commander operational early.

Everything else is a guess around that number. Land count still follows
[`MANABASE.md`](MANABASE.md); do not replace Karsten with "always 38"
because a template said so.

### 2. Lands first, then the remaining slots

True lands are not interchangeable with rocks. After the mana base is
sketched, the leftover cards are utility (ramp, draw, interaction) and
plan (the joke). Filling the joke first and hoping the skeleton appears
is the usual failure.

### 3. Ramp and draw move together

Ramp's effective value is highest **before** the threshold. Draw's
effective value climbs **after** the hand empties. One without the other
is a known break: all ramp and no cards, or a full grip you cannot cast.

Rebell's opening split keeps a combined **24** ramp-plus-draw slots and
moves the mix with the threshold (not a law; a starting mix):

```text
threshold 1–2  →  ~8 ramp / ~16 draw
threshold 3    →  ~10 ramp / ~14 draw
threshold 4    →  ~12 ramp / ~12 draw
threshold 5+   →  ~14 ramp / ~10 draw
```

Command Zone ep. 658's comparison point for a typical midrange 99 is
closer to **~10 ramp / ~12 dedicated card advantage**, with lands handled
separately. Cheap commanders that dump the hand still want more draw.
Expensive commanders still want ramp that is live before the threshold
(a turn-seven Talisman is the "hot garbage" case).

If the commander *is* the ramp or the draw, those 99 slots can lean the
other way. Say so; do not silently skip the category.

Draw cards are not interchangeable. Name raw draw, impulse access,
filtering, triggered engines, and burst refills separately. Compare each
candidate on **timing, scale, and cost**; prefer draw that rewards the deck's
verb rather than pausing it to draw generic cardboard.

### 4. Interaction is buckets, not a pile

"Run twelve disruption" is only useful as a density check. Name the
buckets from [`INTERACTION.md`](INTERACTION.md) (protection vs
disruption, hand vs board, wipe vs pinpoint, fogs vs stacks). Command
Zone 658's comparison point is ~12 targeted and ~6 mass; many role-count
blogs run fewer wipes. Aggro and combo should look thin on purpose;
control should look fat on purpose.

Instant-speed answers and sorcery-speed answers are not the same package.
Rebell's removal model offers another useful lens: **survival** (stop a win),
**unlocking** (remove what blanks this plan), and **suppression** (de-escalate
the board). Compare answers on cost, speed, range, and flexibility. Her
starting densities are about 12 for proactive decks and 18 for reactive
decks, but the mix of jobs matters more than hitting either number.

### 5. Plan cards: enablers, payoffs, enhancers

Whatever is left after mana and utility is the deck. Command Zone splits
that remainder roughly **40% enablers / 35% payoffs / 25% enhancers**:

- **Enablers** make the verb possible (outlets, extra land drops, blink
  engines, the spells you actually sling).
- **Payoffs** turn the verb into a win or a resource (the drain, the
  token, the extra combat).
- **Enhancers** make it nicer (lords, doublings, cost reduction). Cut
  these first when the list is over 99.

Too many payoffs with no enablers is a hand of dead cards. Too many
enablers with no closer is a humming engine that never ends the game.
Win-more cards and orphaned leftover themes belong in the maybeboard.

8×8 / cube-style building is the same idea with rounder numbers: about
eight cards per named theme package so you actually draw the theme. A
package of three is a hope, not a plan.

Rebell's newer engine model is more input-heavy: start a **21-card** theme
package near **12 enablers / 6 payoffs / 3 scalers**. Good enablers are cheap,
self-sufficient, and repeatable. Start with payoffs that can actually end the
game, then work backwards to the resource they need. A commander that is a
cheap, reliable enabler or payoff can move the split; a commander that costs
six does not make an opening hand of payoffs functional.

These sources evolved and do not share one sacred plan-slot count: Command
Zone says roughly 30, Rebell's goldfish video says roughly 27, and her newer
engine video uses 21. Pick a provisional package, calculate its availability,
then goldfish it.

### 6. Curve around the threshold

Density at 2–4 is the usual midrange shape. High-cost commanders need a
real early sequence, not a pile of six-drops plus "we'll ramp." Low-cost
commanders can still want later cards if the operational threshold is
late.

Average mana value is a smell test, not a cap. Karsten's land formula
already uses it.

### 7. Goldfish, then keep the strange cards

Templates exist to get to a testable 100 quickly. This table still
prefers esoteric cards over staples (`DECISIONS.md`). Use the numbers to
find holes, then fill holes with on-theme or old cards, not with the
example staples from the videos.

Use Rebell's two-pass distinction:

1. **Rough:** placeholders are allowed. Play a provisional 100 through about
   turn six until enablers, payoffs, and commander sequencing produce the
   intended proactive plan.
2. **Polish:** inspect at least ten opening hands. Record why each is keep,
   marginal, or mulligan; tune the recurring failure, not the memorable card.

Then use `simulate-deck` pressure branches. Solo goldfishing cannot establish
whether interaction or recovery is sufficient.

For linear, commander-centric plans, test a pivot: can some ramp, draw, or
answer slots also develop the backup route? Rebell's midrange experiment is
to try flexible cards in roughly half of each role package. That is useful
when it improves recovery; it is harmful when a modal card is bad at both
jobs. Always ask what the deck does before the commander and after it is
removed twice.

## Calculator

Use the local calculator when a package count is being argued:

```bash
python3 .agents/skills/design-deck/scripts/construction_calculator.py \
  profile --threshold 4 --lands 40 --ramp 12 --draw 12 \
  --interaction 12 --enablers 12 --payoffs 6 --enhancers 3
```

It reports exact package, raw-land-drop, and joint
enabler-plus-payoff probabilities. Defaults are a 99-card library, seven-card
opener, and one draw each Commander turn. Mulligans, tutors, selection, and
cross-role overlap are stated assumptions; pass `--engine-overlap N` when
cards belong to both engine halves. For one arbitrary package:

```bash
python3 .agents/skills/design-deck/scripts/construction_calculator.py \
  odds --copies 8 --seen 11 --at-least 1
```

Numbers explain how often a package appears, not whether its cards are good.
The calculator does not imitate Commander Template's curve chart because the
full table or formula is not public in the videos.

## Comparison points (not floors)

| Role | Command Zone 658 (typical) | Rebell / commandertemplate (threshold 4) |
| --- | --- | --- |
| Lands | ~38 (see `MANABASE.md` instead) | "at least 38" in that model |
| Ramp | ~10 | ~12 of a 24 ramp+draw budget |
| Card advantage | ~12 dedicated | ~12 of that same 24 |
| Targeted disruption | ~12 | ~12 interaction (undivided) |
| Mass disruption | ~6 | inside interaction |
| Plan / themes | ~30, then 40/35/25 split | newer engine start: 12 enablers / 6 payoffs / 3 scalers |

Generic "36 lands, 10 rocks, 10 draw, 8 removal, 3 wipes" blogs are the
same family of hints, usually lighter on wipes and lands. Do not average
them into a new law.
