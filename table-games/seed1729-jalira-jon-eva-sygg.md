# The Polyfisher vs Unwanted Presents vs Foggy Blood Transfusion vs Thousand Cuts — seed 1729

Four-player Bracket 2+ game recorded with `simulate-table`. Turn order is
clockwise from p1. The React player reads its validated public replay data.

**Result:** no winner inside the twelve-turn horizon. Only
[Thousand Cuts](../decks/2+_sygg-thousand-cuts/README.md) is eliminated, on turn
8. [Unwanted Presents](../decks/2+_jon-irenicus-unwanted-presents/README.md)
gives [The Polyfisher](../decks/2+_jalira-the-polyfisher/README.md) two presents
she never asked for — a copy of Yukora that eats her own board on turn 6, and an
[Aetherize](https://scryfall.com/card/gtc/32/aetherize) that returns her entire
attack on turn 11.

## Seats

| Seat | Deck | Commander | Mulligans | Final life | Outcome |
|---|---|---|---|---|---|
| p1 | [The Polyfisher](../decks/2+_jalira-the-polyfisher/README.md) | [Jalira, Master Polymorphist](https://scryfall.com/card/a25/63/jalira-master-polymorphist) | 1 | 9 | Alive at the horizon |
| p2 | [Unwanted Presents](../decks/2+_jon-irenicus-unwanted-presents/README.md) | [Jon Irenicus, Shattered One](https://scryfall.com/card/clb/278/jon-irenicus-shattered-one) | 0 | 16 | Alive at the horizon |
| p3 | [Foggy Blood Transfusion](../decks/2+_lady-evangela-foggy-blood-transfusion/README.md) | [Lady Evangela](https://scryfall.com/card/leg/240/lady-evangela) | 1 | 13 | Alive at the horizon |
| p4 | [Thousand Cuts](../decks/2+_sygg-thousand-cuts/README.md) | [Sygg, River Cutthroat](https://scryfall.com/card/znc/103/sygg-river-cutthroat) | 2 | 0 | Eliminated turn 8 |

Jalira mulliganed a two-giant seven and kept five Islands plus
[Hard Evidence](https://scryfall.com/card/mh2/46/hard-evidence), bottoming an
Island. Evangela mulliganed a zero-land pile of finishers and bottomed
[Mister Negative](https://scryfall.com/card/spm/135/mister-negative). Sygg's
first six had only an Island because
[Foulmire Knight](https://scryfall.com/card/mid/100/foulmire-knight) is an
Adventure, not a land; the two-land keep is four lands and
[Dimir Signet](https://scryfall.com/card/clu/221/dimir-signet). Jon kept seven.

## Turning points

**Turn 3 — commander before fodder.** Three Islands and
[Sky Diamond](https://scryfall.com/card/c21/264/sky-diamond) are exactly
Jalira's `{3}{U}`, so she resolves a turn before
[Hard Evidence](https://scryfall.com/card/mh2/46/hard-evidence) rather than
after it, and her summoning sickness wears off in time to fish on turn four.
Jon taps Island and [Gloomlake Verge](https://scryfall.com/card/dsk/260/gloomlake-verge)
for [Mystic Remora](https://scryfall.com/card/dmr/59/mystic-remora)'s second
age counter, which leaves only a colorless
[Rogue's Passage](https://scryfall.com/card/soc/407/rogues-passage) and no
Drinker of Sorrow this turn. Evangela holds
[Expedition Map](https://scryfall.com/card/fdn/724/expedition-map) until the end
step, because the ability has no timing restriction and she does not need the
land until turn four.

**Turn 4 — Remora goes, the engine starts.** Paying `{3}` would leave Jon one
mana and no commander, so he lets Remora die after four cards and casts
[Jon Irenicus, Shattered One](https://scryfall.com/card/clb/278/jon-irenicus-shattered-one).
Jalira makes the Crab in her main phase and then does nothing with it.

**Every polymorph waits for the last end step of the round.** The ability is
`{2}{U}`, `{T}`, sacrifice — an activated ability with no timing restriction, so
there is no reason to fire it in her own main phase. The creature she finds can
attack on her next turn either way, and holding means removal pointed at her
fodder or at Jalira herself can be answered by sacrificing in response. She
activates on the end step of the opponent to her right, which is Thousand Cuts
until he dies and Foggy Blood Transfusion after that.

It costs her something immediately: because
[Faerie Artisans](https://scryfall.com/card/cmm/92/faerie-artisans) does not
arrive until the end of turn 4, it never copies
[Crypt Ghast](https://scryfall.com/card/rvr/70/crypt-ghast) or
[Rug of Smothering](https://scryfall.com/card/clb/336/rug-of-smothering). It
also gains her something immediately: Jon has
[Psychic Impetus](https://scryfall.com/card/clu/92/psychic-impetus) in hand on
turn 5 and no 12/12 to goad with it, because the 12/12 is not on the battlefield
yet. He holds it until turn 7 and puts it on the Construct instead.

**Turn 5 — the copy has to be donated too.** Jon casts
[Sleeper Agent](https://scryfall.com/card/dmr/106/sleeper-agent) and it gives
itself to Sygg; handing it to Jalira would only be free fodder for a deck that
sacrifices its own creatures. Faerie Artisans then copies it, and the copy has
the same enter trigger, so Jalira must donate hers as well. She picks Evangela,
who has the next upkeep of anyone at the table and eats the two damage before
her own [Lady Evangela](https://scryfall.com/card/leg/240/lady-evangela) enters
and exiles the token.

**Turn 6 — the present under her own board.** Jon casts
[Yukora, the Prisoner](https://scryfall.com/card/chk/144/yukora-the-prisoner)
and gifts the original to Evangela, but Faerie Artisans has already copied it.
When Evangela's [Baird](https://scryfall.com/card/dom/9/baird-steward-of-argive)
enters on the next turn, Artisans exiles the older token — and a token copy
keeps every ability, including *when Yukora leaves the battlefield, sacrifice
all non-Ogre creatures you control*. Jalira sacrifices her commander, Faerie
Artisans, [Ancient Stone Idol](https://scryfall.com/card/mkc/222/ancient-stone-idol)
and [Triplicate Titan](https://scryfall.com/card/c21/79/triplicate-titan) in one
trigger. Holding the ability pays for itself here: with the sacrifice trigger on
the stack she cashes in the doomed Baird copy first, and the Triplicate Titan
she finds dies to that same trigger and leaves three Golems behind. Together
with the Idol's Construct she keeps a board — but the commander and the fishing
engine are gone, and Jalira costs six to recast.

**Turns 5–7 — Thousand Cuts empties his hand instead of holding it.** Six mana
on turn 5 buys [Ivory Tower](https://scryfall.com/card/tpr/232/ivory-tower) and
[Vile Consumption](https://scryfall.com/card/inv/78/vile-consumption), which is
a full turn earlier than a losing board can afford to wait: every creature at
the table now costs its controller a life each upkeep, and Jalira's token army
is the one paying most. Turn 6 is
[Urza's Guilt](https://scryfall.com/card/dmr/68/urzas-guilt) — four life a seat
and three cards out of every hand, including his own. Jalira discards
[Void Winnower](https://scryfall.com/card/cmm/315/void-winnower) there, which is
why nobody spends the rest of the game unable to cast even-cost spells. Turn 7
is [Scrawling Crawler](https://scryfall.com/card/ltc/153/scrawling-crawler), so
every card the other three draw, draw step included, costs them a life.

The one creature Vile Consumption cannot touch is a present. Its trigger is
*sacrifice this creature unless you pay 1 life*, and Irenicus's gifts cannot be
sacrificed, so declining to pay for them does nothing at all.

**Turn 8 — one death takes three permanents with it.** The Construct, both
Golems and the goaded [Drinker of Sorrow](https://scryfall.com/card/lgn/66/drinker-of-sorrow)
finish Sygg. The Drinker is a 5/3 that becomes a 7/5 with the counters Irenicus
staples on, and it cannot block and makes its controller sacrifice a permanent
every time it connects — Jalira loses her Clue for the privilege of being given
it. Everything Sygg owns leaves the game with him, so
[Vile Consumption](https://scryfall.com/card/inv/78/vile-consumption),
Scrawling Crawler and [Ivory Tower](https://scryfall.com/card/tpr/232/ivory-tower)
all stop at once. On the same turn cycle the original Yukora is goaded with only
Jalira left to attack — and this is the other half of holding the ability.
Attackers are declared, and only then does she polymorph the Mirrex Mite into
[Lord of Change](https://scryfall.com/card/40k/33/lord-of-change), a 6/6 blocker
Evangela had no way to play around. Yukora dies to it and wipes her board the
same way its copy wiped Jalira's.

**Turn 11 — Repay in Kind, then Aetherize.**
[Diluvian Primordial](https://scryfall.com/card/gtc/32/diluvian-primordial)
enters and casts [Repay in Kind](https://scryfall.com/card/m10/113/repay-in-kind)
free out of Evangela's graveyard, where Urza's Guilt had put it. Jalira has the
lowest life total at sixteen, so Jon falls from thirty-two and Evangela from
eighteen to meet her. The goaded Construct, Drinker and Oni are then forced at
Evangela for twenty-two against sixteen, while Hulking Metamorph, Mind Flayer
and the stolen Greater Harvester go at Jon for fifteen against sixteen. He
answers with Aetherize, which saves Evangela from lethal at the same time:
every attacking creature Jalira controls
goes back to its *owner's* hand, which sends Drinker of Sorrow,
[Painwracker Oni](https://scryfall.com/card/chk/128/painwracker-oni) and
[Greater Harvester](https://scryfall.com/card/chk/113/greater-harvester) home to
Jon and leaves the Construct token to cease existing. Six turns of fishing undone
by one instant, and the presents are back in the box ready to be given away
again.

**Turns 6–12 — the gifts pay Jon back.** Irenicus hands out tapped creatures,
but they untap on the recipient's untap step and are goaded, so they have to
attack somebody. Every one of those attacks draws him a card, twice a turn once
both Drinker and the Oni are out, and it is the only card advantage he has after
Remora dies. He ends the twelve turns as the healthiest seat with a full grip.

## Watch it

[Watch on GitHub Pages](https://lordnox.github.io/commander-decks/?game=seed1729-jalira-jon-eva-sygg).

```bash
bun run table:render -- table-games/seed1729-jalira-jon-eva-sygg.json
```

This is one seed, not a metagame. Known simplifications: opponents never pay
Mystic Remora's `{4}`, Fact or Fiction's piles are split by judgment rather than
search, cleanup discards follow a fixed pitch order per seat, and the compact
catalog omits "Legendary" on Ancient Silver Dragon and Summon: Bahamut, which
are skipped from Oracle instead.
