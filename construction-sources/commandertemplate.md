# commandertemplate.com / Rebell Lily — working notes

Site: https://commandertemplate.com/

The public site is a Commander-only builder (categories, Scryfall `o:` tags,
land cycles, goldfish notes, "intelligence mode"). As of **2026-09-14** it is
Cloudflare-protected JavaScript; automated fetches often stop at the
challenge page. The blog index listed one Foundations article
([What is Bracket 4?](https://commandertemplate.com/blog/what-is-bracket-4),
2026-07-05) and zero posts under Mana Base, Card Selection, Strategy, Using
CT, and FAQ.

Construction advice therefore comes from the author's videos and posts, not
from scraping the app.

This is a working summary, not a transcript. Copyright remains with Rebell
Lily. Card examples stay illustrations.

## Videos

- *THIS is how many lands you SHOULD be playing in Commander*
  (https://www.youtube.com/watch?v=FIZ8Kerv3eA)
- *Which Card Draw Spells Are Actually Good?*
  (https://www.youtube.com/watch?v=TK35fgkHbEQ)
- *How Much Removal Do You Need in Commander?*
  (https://www.youtube.com/watch?v=e2KYdKjcXm0)
- *Why "Synergy" is Actually Killing Your Deck*
  (https://www.youtube.com/watch?v=u-7plTZItgo)
- *The Goldfish Test Every Commander Player Needs*
  (https://www.youtube.com/watch?v=b2uOL3SKmPo)
- *Using the Forgotten "Cube Theory" To Build Commander Decks*
  (https://www.youtube.com/watch?v=QHch2cmPsVM)
- *SAVE Your Commander Deck By Midrangeifying It*
  (https://www.youtube.com/watch?v=PgM_ZV-_n7g)
- *Your Voltron Deck Dies to One Card*
  (https://www.youtube.com/watch?v=xz445idNQWE)
- *The Math Behind Your Ramp and Card Draw Ratio*
  (https://www.youtube.com/watch?v=IQVw-XCrntQ, published 2026-03-26)
- *I Built the Deck Builder Commander Actually Needs*
  (https://www.youtube.com/watch?v=KCXWzqCErqE) — tour of the site
- Author's launch notes: Reddit r/EDH and r/magicTCG,
  "I Turned All My Commander Deckbuilding Research Into An Online Builder"

## Model (as stated in those videos)

**Operational threshold:** the turn or mana value when the deck starts doing
the thing. Default is the commander's mana value. Override when the 99 plays
at a different speed than the commander (cheap commander, late plan).

**Land floor** in this model: at least 38 lands ("hot garbage model"). That
disagrees with Karsten in [`MANABASE.md`](../MANABASE.md). This repo keeps
Karsten as the land starting guess.

The earlier land-count video reaches **43** by scaling limited's 17/40 ratio
to 100 cards, then recommends **40** as a practical hedge with spell/land
MDFCs, landcycling, cycling lands, and useful lands to reduce flooding. It
suggests no more than ten always-tapped lands. That ceiling is too loose for
this table's tempo preference and is not imported into `MANABASE.md`.

There is also a counting error in that video's turn-four example: it calls the
sample 12 cards, but a Commander library has 99 cards and a seven-card opener
plus four normal draw steps is **11** cards. With 40 lands the exact chance of
seeing at least four is **72.6%**, not the video's approximately 80%; 12 cards
seen produces 79.9%. Free-mulligan behavior requires an explicit keep policy
and cannot be modeled by adding a card to the sample.

**Ramp + draw budget:** 24 slots, split by threshold:

| Operational threshold | Ramp | Draw |
| --- | --- | --- |
| 1–2 | ~8 | ~16 |
| 3 | ~10 | ~14 |
| 4 | ~12 | ~12 |
| 5+ | ~14 | ~10 |

Yidris (four mana) in the builder tour showed **12 ramp / 12 draw / 12
interaction** as the default recommendation. Other commanders get other
numbers. Intelligence mode overlays hypergeometric package odds and a curve
chart of where to cut or add by mana value. The author says the math is not
gospel; goldfish for context.

**Value unit** used to tie ramp to draw: one land drop plus one card per turn
as the baseline "clock." Ramp's effective value is highest before the
threshold; draw's climbs as the game goes long. Inverse relationship: you
want both.

**Three failures** (Liebig-style: the shortest leg kills the crop):

1. Lands — immediate, often unrecoverable.
2. Ramp — ceiling; you play fair while the table goes over the top.
3. Draw — quiet; empty hand while others refill.

Fix in that order.

**Builder UX that is actually a construction hint:**

- Split **thematic packages** (how you win) from **utility packages** (draw,
  ramp, interact).
- Theme packages of about **eight cards** (cube theory), with follow-on
  theme suggestions.
- Land basics weighted to the colour of spells already in the list.
- Goldfish early; mark keep / cut / question; iterate. Do not polish a 200
  card maybeboard forever.

The site's intelligence functions are described by the author as precomputed
hypergeometric formulas plus Scryfall, not an LLM.

## Draw advice

The draw video separates five effects:

- raw draw;
- temporary impulse access;
- looting / filtering (selection, not card-positive);
- trigger-based draw;
- refill / burst draw.

Evaluate candidates on **timing, scale, and cost**. The core qualitative
advice is good: prefer draw that rewards the deck's existing verb and scales
that engine. Its earlier numeric floor was eight draw effects; the newer
threshold model supersedes that with 10–16 draw slots.

## Removal advice

Evaluate an answer on **cost, speed, range, and flexibility**, then name its
job:

- **survival** — stop a win; reactive speed matters;
- **unlocking** — remove the specific thing that blanks this deck;
- **suppression** — de-escalate a board; range and card tempo matter.

The video starts aggressive decks near 12 interaction cards and slower,
reactive decks near 18. These are density comparisons, not universal floors.
Theme-compatible or modal answers can preserve deck identity. This maps onto,
but does not replace, [`INTERACTION.md`](../INTERACTION.md).

## Engine advice

Treat the theme as a resource conversion:

```text
input / enabler → repeatable process → output / payoff
```

Start from a payoff that can actually end the game, then work backwards.
Good enablers are cheap, self-sufficient, and repeatable. Payoffs can cost
more but should convert the resource toward winning, not merely into another
engine piece.

The newer engine video reserves 21 theme slots as a starting package:

- **12 enablers** — 60.7% to open at least one; 77.8% to see one by turn four;
- **6 payoffs** — 51.6% to see one by turn four;
- **3 multipliers / scalers**.

Those exact figures use a 99-card library, a seven-card opener, and eleven
cards seen by turn four. The commander can alter the split if it is a cheap,
reliable input or output. It does not erase the need for the other half.

## Goldfish advice

Two passes:

1. **Rough** — get to a provisional 100 quickly, test the proactive plan
   through about turn six, and ask whether enablers flow into payoffs and
   where the commander belongs. Placeholders are fine.
2. **Polish** — draw ten opening hands without playing all of them. Record
   keep, marginal, and mulligan reasons; tune until most hands support the
   declared plan.

Then add disruption branches. Solo goldfishing cannot prove that an
interaction package is sufficient.

## Other qualitative advice worth keeping

- Cube Theory's original eight packages were ramp, removal, draw, protection,
  two synergy themes, support, and generic good cards. Keep the package
  scaffold but drop the last category here: this table does not add staples
  merely because they are generically strong.
- For a more resilient midrange version of a linear deck, give it a pivot that
  shares its finisher and replace some one-use role cards with cards that
  develop a board while doing the role. Rebell suggests trying half of each
  package as flexible cards; treat that as an experiment, not a quota.
- Commander-centric decks need an explicit post-removal line. The Voltron
  video reframes casual Voltron as inevitability: develop draw, haste,
  secondary threats, politics, and recovery before revealing the lethal
  equipment or Aura turn. That is archetype-specific, but the general test is
  useful: what does the 99 do before the commander and after it is removed
  twice?

## Calculator

[`construction_calculator.py`](../.agents/skills/design-deck/scripts/construction_calculator.py)
implements the exact hypergeometric package odds, joint enabler-plus-payoff
odds, raw land-drop odds, and the published operational-threshold ramp/draw
table. It defaults to the correct 99-card library and makes omitted mulligans,
selection, and tutors explicit.

It intentionally does **not** reconstruct Commander Template's mana-curve
recommendations: the videos show the app's output but do not publish the full
curve table or formula. Encoding guessed coefficients would give false
precision.

## How this repo uses it

Steal the operational-threshold question and the ramp/draw inverse, not the
frozen 38/12/12/12 law. Interaction still goes through
[`INTERACTION.md`](../INTERACTION.md). Lands still go through
[`MANABASE.md`](../MANABASE.md).
