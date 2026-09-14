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

## How this repo uses it

Steal the operational-threshold question and the ramp/draw inverse, not the
frozen 38/12/12/12 law. Interaction still goes through
[`INTERACTION.md`](../INTERACTION.md). Lands still go through
[`MANABASE.md`](../MANABASE.md).
