# How Many Sources Do You Need to Consistently Cast Your Spells? A 2022 Update

- Author: Frank Karsten
- Original: https://www.tcgplayer.com/content/article/How-Many-Sources-Do-You-Need-to-Consistently-Cast-Your-Spells-A-2022-Update/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8/
- Published: 2022-08-02T12:00:28Z
- Cached: 2026-09-13 from TCGplayer Infinite API (`/c/article/dc23a7d2-0a16-4c0b-ad36-586fcca03ad8`)
- Note: Offline working copy for this repository. Copyright remains with the original author and publisher.

---

The creation of a solid mana base is one of the most important aspects of deck building. You always need a strong foundation to ensure you'll hit your colors in time to cast your spells. So when choosing the lands for your deck, it is important to know how many sources of untapped red mana you need to consistently cast Monastery Swiftspear on turn one or how many sources of blue mana you need to consistently cast Narset, Parter of Veils on turn three. This article will provide helpful guidelines for this aspect of mana base construction.

Before describing my methodology and assumptions in detail, I will start with a quick summary of the results as a quick reference. Sorted from low to high, here is how many colored sources you need to cast your spells consistently on curve. For the mana cost, "C" stands for an arbitrary colored mana symbol.

| **Mana cost** | **Example spell** | **Number of colored sources required** |

|  |  | **60-card deck** | **80-card deck** | **99-card deck** | **40-card deck** |

| 5C | Drowner of Hope | 9 | 12 | 14 | 6 |

| 4C | Doubling Season | 9 | 14 | 15 | 6 |

| 3C | Collected Company | 10 | 15 | 16 | 7 |

| 2C | Reckless Stormseeker | 12 | 16 | 18 | 8 |

| 5CC | Hullbreaker Horror | 12 | 17 | 20 | 8 |

| 1C | Ledger Shredder | 13 | 18 | 19 | 9 |

| 4CC | Primeval Titan | 13 | 19 | 22 | 9 |

| C | Monastery Swiftspear | 14 | 19 | 19 | 9 |

| 3CC | Baneslayer Angel | 15 | 20 | 23 | 10 |

| 4CCC | Nyxbloom Ancient | 16 | 22 | 26 | 10 |

| 2CC | Wrath of God | 16 | 23 | 26 | 11 |

| 3CCC | Massacre Wurm | 17 | 24 | 28 | 11 |

| 1CC | Narset, Parter of Veils | 18 | 25 | 28 | 12 |

| 2CCC | Garruk, Primal Hunter | 19 | 26 | 30 | 13 |

| CC | Lord of Atlantis | 21 | 28 | 30 | 14 |

| 1CCC | Cryptic Command | 21 | 29 | 33 | 14 |

| 1CCCC | Unnatural Growth | 22 | 31 | 36 | 15 |

| CCC | Goblin Chainwhirler | 23 | 32 | 36 | 16 |

| CCCC | Dawn Elemental | 24 | 34 | 39 | 17 |

In previous articles, I analyzed colored source requirements under different mulligan rules and different assumptions. In 2013, I wrote the classic ["How many colored sources do you need to consistently cast your spells"](https://www.channelfireball.com/articles/frank-analysis-how-many-colored-mana-sources-do-you-need-to-consistently-cast-your-spells/), which was filled with useful mana tables for the Paris Mulligan rule. In 2018, I provided an [update](https://www.channelfireball.com/all-strategy/articles/how-many-colored-mana-sources-do-you-need-to-consistently-cast-your-spells-a-guilds-of-ravnica-update/) for the Vancouver Mulligan rule. This 2018 article also tweaked the underlying calculations and assumptions. In 2020, I had [another update](https://strategy.channelfireball.com/all-strategy/mtg/channelmagic-articles/how-many-sources-do-you-need-to-consistently-cast-your-spells-an-iko-update/) on CFB Pro, incorporating the London Mulligan rule, numbers for 80-card decks and guidance for different land counts. In today's update, I've incorporated the free mulligan and free draw for Commander, I've added 1CCCC spells to the tables, tweaked the underlying land counts, updated and expanded various examples and added some words on newly printed cards such as modal double-faced cards.

Because of some changing assumptions to better reflect land counts in 2022, the number of colored sources required for various spells in 60-card decks and 80-card decks has increased by one compared to the previous edition. And as a result of incorporating the free mulligan and free draw for Commander, the number of colored sources required for various spells in 99-card decks has decreased. The impact is particularly noticeable for one-drops and two-drops, where the number of colored sources required in Commander has gone down by as much as three or four.

## How is "consistently cast" defined?

Consider a card with converted mana cost M that requires N pips of a certain color. For example, Wrath of God has M = 4 and N = 2. In line with my preceding articles, I will then say that a mana base can consistently cast this card if there is at least a 89 + M % probability to draw at least N colored sources by turn M on the play conditional on drawing at least M lands by that turn, given a reasonable mulligan strategy and number of lands in the deck. For Wrath of God, this means that the deck should be 93 percent to have at least two white sources by turn four on the play, conditional on drawing at least four lands by turn four after mulligans.

I justify and explain the underlying assumptions for a card with converted mana cost M as follows:

- **We want to have 89 + M % consistency**: Due to the randomness of your draws, you can never attain 100 percent consistency in practice. Based on my deck building experience and on reviews of successful tournament decks, roughly 90 percent consistency (on the play) is a good number to aim for, but this number should be higher for the top-end of your curve. Indeed, as I argued more extensively in a [previous article](https://www.channelfireball.com/all-strategy/articles/how-many-colored-mana-sources-do-you-need-to-consistently-cast-your-spells-a-guilds-of-ravnica-update/), if you are unable to cast a one-drop creature on turn one, then you can probably play a tap-land and fit it into your curve later, but if you are unable to cast a game-changing five-drop on turn five because you didn't draw the right colors, then that can have a massive impact. For this reason, I increase the consistency requirements for spells with higher converted mana costs: 90 percent consistency for one-mana cards, 91 percent consistency for two-mana cards, 92 percent consistency for three-mana cards and so on, up to 96 percent for seven-mana cards.
- **We want to cast the spell on turn M**: Curving out (i.e., playing a land each turn and using all of your mana each turn) is a good way to win games of Magic. Mana bases should be built with this in mind by requiring the right mana to be needed on turn M (i.e., the first turn that you can cast the card under consideration).
- **We condition on drawing at least M lands by turn M**: If your blue-white deck is stuck with Wrath of God in hand because the only lands you drew all game were two Plains, then that doesn't mean that your Plains/Island ratio was off. The problem was that you only drew two lands. In this article, I am not interested in mana base failures due to not drawing enough lands. You can check out [this article](https://strategy.channelfireball.com/all-strategy/home/how-many-lands-do-you-need-in-your-deck-an-updated-analysis/) to see how many lands you should play as a function of your average mana value. In the present article, I will assume that you have already chosen a suitable number of lands for your deck and I will merely focus on colored mana ratios. From this perspective, the question of whether or not we have enough white sources to cast Wrath of God only becomes relevant if we've drawn at least four lands by turn four in the first place. Hence, we look at the conditional probability: The probability to draw at least two white sources *and* at least four lands by turn four, divided by the probability to draw at least four lands by turn four. These conditional probabilities are the ones that will be shown in tables in this article.
- **There are a realistic number of lands in the deck**: Conditioning on drawing a certain number of lands means that we need to make an assumption on the number of lands in the deck. As a slight deviation from preceding articles, I will assume that a 40-card deck contains 17 lands, a 60-card deck contains 25 lands, an 80-card deck contains 35 lands and a 99-card deck contains 41 lands (you could view mana rocks as partial lands). These new land counts are generally one higher than what I assumed in preceding "how many colored sources" articles, but they're more typical numbers for 2022 Magic. They are closer to the idealized mana curve and land count frameworks that I derived in [this article](https://strategy.channelfireball.com/all-strategy/home/whats-an-optimal-mana-curve-and-land-ramp-count-for-commander/). For further arguments supporting higher land counts in 2022 Magic, I refer to Reid Duke's article entitled ["Your land count is too low!"](https://strategy.channelfireball.com/all-strategy/home/your-land-count-is-too-low-strategy-highlight/) Later in the article, I will explain how to account for vastly different land counts. However, the recommended number of colored sources remain reasonable as rules of thumb for decks that are close to the assumed number of lands (say, 60-card decks with 22 to 28 lands).
- **In Commander, there's a free mulligan and a free draw on turn one**: The official rules on the [Commander RC page](https://mtgcommander.net/index.php/rules/) or on [WotC's format page](https://magic.wizards.com/en/formats/commander) don't mention a free mulligan or a draw step for the starting player, which is why I've never used these rules in previous articles. Yet they're more than typical house rules. Comprehensive rule 103.4c says "In a multiplayer game and in any Brawl game, the first mulligan a player takes doesn't count toward the number of cards that player will put on the bottom of their library or the number of mulligans that player may take." And comprehensive rule 800.7 says "In a multiplayer game other than a Two-Headed Giant game, the starting player doesn't skip the draw step of their first turn." Accordingly, these rules are now part of my Commander analysis.
- **The probability is based on a reasonable London mulligan strategy**: If we want to realistically model games of Magic, especially when it pertains to the number of lands in our opening hand, then we need to take mulligans into account. I model the London Mulligan rule as follows: we mulligan any free seven-card hand in Commander with zero, one, two, six or seven lands, any regular seven-card hand with zero, one, six or seven lands, any six-card hand that after bottoming contains zero, one, five or six lands, any five-card hand that after bottoming contains zero, one or five lands and we keep all other hands. To get a good mix, we aim with bottoming to get close to three lands. With six-card hands, we bottom a spell if we drew three or more spells, and we bottom a land otherwise (this represents a change from my previous article, where I assumed you wanted to get close to four lands and two spells. Based on progressive insight and experience with the London Mulligan rule, I now believe that closer to three lands and three spells is usually better). With five-card hands, we aim to get close to three lands and two spells: we bottom two spells if we have four or more spells, we bottom a spell and a land if we have three spells, and we bottom two lands if we have two or fewer spells. With four-card hands, we aim to get close to three lands and one spell in an analogous way. Any time we have to bottom lands, we first put off-color lands on the bottom as much as possible. That is, with the Wrath of God example, we'd push an Island to the bottom over a Plains.
- **The only mana sources are lands, and there is no card selection: **This assumption is made for tractability. Later in the article, I will explain how to account for cards like Noble Hierarch or Opt. However, the recommended number of colored sources remain reasonable as rules of thumb for decks that are close to satisfying this assumption (say, zero to four card draw spells or mana creatures).

My implementation (in Python, via simulation, for ease of calculation) to derive probabilities can be found [here](https://github.com/frankkarsten/MTG-Math/blob/master/HowManySources2022Update.py).

## The numbers: 60-card decks

The following table provides the probability of casting a spell with a certain mana cost on-curve on the play, taking into account mulligans, conditioning, and other assumptions as described above.

[](https://mktg-assets.tcgplayer.com/content/channel-fireball/article-images/2022/08/How-many-sources-60-cards.png)

In bolded green, I highlighted the minimum number of sources to consistently cast a card on curve, where "consistently" means 90 percent probability for one-drops, 91 percent probability on the play for two-drops and so on, assuming you drew enough lands. Those numbers resulted in the table you saw at the beginning of this article.

## The numbers: 80-card decks

[](https://mktg-assets.tcgplayer.com/content/channel-fireball/article-images/2022/08/How-many-sources-80-cards.png)

## The numbers: 99-card decks

[](https://mktg-assets.tcgplayer.com/content/channel-fireball/article-images/2022/08/How-many-sources-99-cards.png)

## The numbers: 40-card decks

[](https://mktg-assets.tcgplayer.com/content/channel-fireball/article-images/2022/08/How-many-sources-40-cards.png)

## How to deal with gold cards

For gold cards, I generally split up the mana cost, determine the mana source requirements separately for each color and set of colors and finally increase all requirements by one. I'll explain my process via two examples in the context of a 60-card deck:

- Teferi, Time Raveler. From the tables, we know that a 2W card needs 12 sources of white, a 2U card needs 12 sources of blue and an 1CC card needs 18 sources of that color. Hence, for Teferi, I would recommend 13 sources of white, 13 sources of blue, and 19 different sources that can produce white and/or blue.
- Liesa, Forgotten Archangel. From the tables, we know that a 3WW card needs 15 sources of white, a 4B card needs nine sources of black and an 2CCC card needs 19 sources of that color. Hence, for Liesa, Forgotten Archangel, I would recommend 16 sources of white, 10 sources of black and 20 different sources that can produce white and/or black.

The reason for increasing all mana requirements by one is that for gold cards, you need all colors to be present. To illustrate, suppose that you would be 90 percent to have a white source on turn three and that you would be 90 percent to have a blue source on turn three. For exponential ease, suppose that these two probabilities would be independent. Then, you would only be able to cast Teferi, Time Raveler 90% * 90% = 81% of the time on curve. Although this number would be higher in a more precise model that takes into account that these two probabilities are not in fact independent, the basic effect would still be present. To avoid it, my rule of thumb is to increase the individual requirements by one. This is an imprecise hack, but it generally leads to good results.

Note, however, that this gold card adjustment is only necessary when you're worried about the colored mana consistency of both colors. If you're splashing Teferi in an otherwise mono-white deck where each land produces white mana, then that's equivalent to splashing a 2U card.

## How to deal with hybrid cards and other unusual mana costs

For hybrid spells, you need to have enough combined sources of either color in the hybrid cost. For example, if you have four Hallowed Fountain, eight Islands and eight Plains in an 80-card deck, then that's 20 sources for Yorion, Sky Nomad on turn five. Perfect.

For convoke cards, delve cards, X-spells and/or other cost reduction effects, you should imagine the typical amount of lands that you expect to tap to cast the spell. Then use those lands to represent the card's mana cost. For example, you might treat Murktide Regent as a 1UU card in a deck that rapidly fills its graveyard, and you might treat March of the Multitudes as a 3GW card in a deck with plenty of white creatures.

For a card with an alternative cost, such as Fury, it depends on how often you expect to cast it for its regular cost. If you never plan to cast it for 3RR, then you can ignore it when constructing your mana base. If you still expect to cast it for 3RR sufficiently often, then treat it as a 3RR spell, but know that it won't be a big deal if you're a few red sources short.

Finally, colorless mana or snow mana should be treated as colors in their own right. So, in 60-card decks, Arcum's Astrolabe needs 14 snow-covered lands or fetches and Thought-Knot Seer needs 10 colorless-producing lands.

## How to account for fetchlands or Pathways

Clearly, a Plains counts as a white source, and a Temple Garden counts as both a white source and a green source. But how about fetchlands?

I usually consider Verdant Catacombs, Flooded Strand and the like as a full mana source for any color that they might be able to fetch. In formats like Modern, where you can fetch shock duals, they are the perfect mana fixers.

Cards like Fabled Passage or Blightstep Pathway, which cannot fetch dual lands and therefore force you to make a real choice, are more complicated. For two-color decks, I would count Fabled Passage or a Pathway as a full mana source for both colors. But for decks with three or more colors and heavy color requirements in multiple colors, Fabled Passage or Blightstep Pathway isn't fully reliable because you have to make a choice. For example, an opening hand with Narset, Parter of Veils, Wrath of God, Goldspan Dragon, Island, Plains, Mountain, Fabled Passage is much worse than the opening hand in which Fabled Passage is replaced by Raugrin Triome. For a deck with these mana costs, I would roughly count each Fabled Passage or Pathway as two-thirds of a source of each color it can produce. This is again an estimate, but sometimes science is more art than science.

## How to account for taplands

For turn one, only untapped sources count. Fabled Passage, Temple of Mystery, Canopy Vista or Sunpetal Grove won't help you cast Llanowar Elves on turn one. On the other hand, Temple Garden, Blooming Marsh or Lair of the Hydra will. When building mana bases in practice, it's often difficult to get to a sufficient number of sources to consistently cast one-drops on turn 1; it tends to be the most difficult constraint to satisfy. Yet if you have a bunch of one-drops that you want to cast on curve, then you'll either have to do you best to get enough turn-one untapped sources or come to terms with lower consistency.

For turn two onward, I generally count all sources, no matter whether they would enter the battlefield tapped or not. This is a simplification that envisions that you can always play tap-lands in preceding turns. But as long as you don't have an outrageous number of tap-lands, it adequately captures the color consistency of your mana base in my experience.

This, of course, begs the question "what's an acceptable number of tap-lands?" This could be a topic for a whole other article, and the real answer is "it depends on your deck." But as a rough indication, I'd recommend playing no more than three tap-lands in 60-card aggro decks with one-drops and no more than nine tap-lands in 60-card midrange/control decks that lack one-drops. Indeed, a deck's ability to freely play a tap-land on turn one is an important factor. When counting tap-lands in your deck for this purpose, a land like Raffine's Tower would count as a full tap-land whereas a conditional land like Sunpetal Grove may count as one-fourth of a tap-land, although the specifics depend on your deck composition and your mana curve. One way or another, I would recommend avoiding vanilla tap-lands like Selesnya Guildgate because so many tap-lands with useful abilities have been printed in recent years.

## How to account for modal double-faced cards

I have to split up this question in two. First, for spell/spell MDFCs where you may cast both sides, such as Esika, God of the Tree, treat it as both a 1GG spell and a WUBRG spell when designing your mana base.

Second, for land/spell MDFCs, you'll want to treat the front side as a regular spell you can cast, but the main question is how to count the back side as a colored sources. For context, when figuring out [how many lands my deck should contain](https://strategy.channelfireball.com/all-strategy/home/how-many-lands-do-you-need-in-your-deck-an-updated-analysis/), I would generally count non-mythic land/spell MDFCs, such as Bala Ged Recovery, as 0.40 land and mythic land/spell MDFCs, such as Emeria's Call, as 0.75 land. However, when figuring out how to count them as colored sources, these numbers wouldn't be entirely accurate. In games where you cast an MDFC like Bala Ged Recovery as a spell, you'll typically be flooding out and then it rarely matters how many green sources you drew - you had no mana troubles anyway. It's the games where you really need a certain color that influence mana consistency the most, and there you'll play it as a land most of the time. Accordingly, for the purpose of counting colored sources, I would roughly count each non-mythic land/spell MDFCs as 0.8 source of its color and each mythic land/spell MDFC as a full source of its color.

## How to account for mana producers or card selection spells

If the deck contains nonland mana sources, then you can count some of them as (partial) colored sources for the purpose of satisfying the requirements from the tables.

To cast cards with mana value two or more, I would generally count fragile mana dorks (e.g., Llanowar Elves, Birds of Paradise or Noble Hierarch) as half a colored mana source for each color they can produce. This is assuming that your deck can cast the mana dorks consistently (i.e., at least 14 untapped green sources in 60-card decks). I count them as half a source because "Bolt the Bird" has been a saying since the early '90s - your mana creature may not survive. But a 60-card deck with 16 blue lands, 14 untapped green sources and four Birds of Paradise can be seen as having the required 18 blue sources for Narset, Parter of Veils.

To cast cards with mana value three or more, I would generally count mana rocks such as Arcane Signet or Dimir Signet as three-fourths of a source for every color. They are more likely to survive or resolve than Birds of Paradise, but a spell is still more fragile than a land.

For card draw spells that cost no more than two mana (also known as cantrips) and that you can already cast consistently, I would count them according to the fraction of your deck that can produce the right colored source and then loosely round down. For instance, if you run 18 Mountain in a 60-card deck, then Crash Through can count as 18/60 of a red source, at least for red cards of converted mana cost two or higher, which I'd loosely round down to one-fourth of a red source.

You could argue that card draw spells should count for less because you don't always have the time to cast them, but you could also argue that they should count for more because you may draw into another card draw spell to dig further. I believe my way of counting is a slight overestimation of how much cantrips provide in terms of colored mana consistency, but that's why I try to play it safe and round down to obtain a reasonable guideline.

Scrying or surveilling is not as good as drawing a card. For example, you sometimes have to dig for another effect than a specific colored source. Also, there are diminishing returns. As a rough guideline, I would count cheap scry or surveil effects as follows:

- A cheap scry 1 effect in a 60-card deck with 18 black lands (or an 99-card deck with 30 black lands) counts as approximately 0.2 black sources.
- A cheap scry 1 effect in a 60-card deck with 9 black lands (or an 99-card deck with 15 black lands) counts as approximately 0.1 black sources.
- A cheap scry 2 effect in a 60-card deck with 18 black lands (or an 99-card deck with 30 black lands) counts as approximately 0.3 black sources.
- A cheap scry 2 effect in a 60-card deck with 9 black lands (or an 99-card deck with 15 black lands) counts as approximately 0.15 black sources.

To illustrate, consider a 60-card deck with 18 black lands. Assume we have enough blue sources to consistently cast cheap blue cantrips on-curve. Then, adding up card draw and scry, I would approximately count each Opt as 0.45 black source and each Omen of the Sea or each Serum Visions as 0.55 black source. I would generally view Brainstorm or Ponder in a similar way, let's say 0.50 black sources each in this situation. Each Mishra's Bauble would count as 0.25 black sources, and each Temple of Mystery would count as 0.2 black sources. All that said, there are diminishing returns to card draw effects, so if you have more than 10 such cards in your deck, count only the first 10 card draw effects.

In decks that can consistently cast Farseek, Three Visits, The Birth of Meletis, Rampant Growth or Sakura-Tribe Elder on turn two (i.e., with at least 13 sources of green mana in 60-card decks) I would count such a two-mana ramp spell as three-fourths of a source of all colors it could find, but only for the purpose of satisfying constraints for cards with mana value three or higher.

Ramp effects that you'd use on turn three, such as Cultivate or Myriad Landscape, only count as colored sources for cards with mana value four or higher, and I wouldn't count them as effectively because you may have better things to cast on turn three. Accordingly, for cards with mana value five or higher, I may count each of these ramp effects as half of a source of any color it could find.

Some cards, like Fires of Invention, help circumvent color requirements, but I would generally try to build my mana base without taking Fires of Invention's color fixing into account. The card gets countered, destroyed or discarded easily, and if you have it on the battlefield then you're usually winning anyway. I'd rather optimize my mana base for games where things don't go according to plan.

## How to account for Treasure generators or opponent-dependent effects

For two-mana, one-shot Treasure generators like Prosperous Innkeeper or Courier's Briefcase, I would roughly count a Treasure as one-fourth of a source of any color, at least for spells with mana value three or higher. It's a bit tricky to count effects that support only one single spell, and it depends on how you expect your deck to play out, but I believe this'll get you close to accurate numbers in practice. When you create multiple Treasures, then count each as one-fourth of a source of any color.

For Commander staples whose effect depends on the opponent, it once again depends. For Dockside Extortionist, imagine the most likely value of X and then count those Treasures. For Fellwar Stone and Exotic Orchard, if you know that one of your opponents is playing a certain color, then you can count Exotic Orchard as a full source of that color and Fellwar Stone as three-fourths of a source of that color. If you don't know what colors your opponents may be playing in a four-player pod, then odds are you'll still get lucky, but to be on the safe side, I'd count Exotic Orchard as three-fourths of a source of any color and Fellwar Stone as half of a source of any color.

## How to deal with decks that have very few or very many lands

Remember that 60-card decks were assumed to contain 25 lands, that 80-card decks were assumed to contain 35 lands, that 99-card decks were assumed to contain 41 lands and that I was interested in conditional probabilities. The probabilities from the tables should be interpreted as saying "assuming you draw enough lands for a card's converted mana cost, how often will you have the right colored sources?" (When translating this model to real decks, you could view mana rocks as partial lands.)

An illustrative way to imagine this is to revisit the Wrath of God example again. What I'm effectively doing to determine my numbers is to shuffle up a deck with Islands, Plains and arbitrary spells, resolve mulligans based on the total number of lands in your hand, draw cards for the first four turns and then check if I have drawn at least four lands, out of which at least two Plains. If so, that's counted as a success. If I drew at least four lands but fewer than two Plains, then that's counted as a failure. If I drew fewer than four lands, then I ignore this game. I then simulate this millions of times, divide the total number of successes by the total sum of successes and failures and repeat for varying numbers of Plains in the deck to construct the table for 2CC spells.

Since these numbers are based on assumptions regarding land counts, my recommendation to run at least 18 blue sources to consistently cast Narset, Parter of Veils in 60-card decks won't be as useful for decks with extremely low or extremely large numbers of lands. For such decks, it would be closer to the truth to say that 18/25 of your lands should be blue. That is also not exact, but it gets you thinking in the right direction.

To be more precise, I ran the numbers again for 60-card decks with 20 lands and 30 lands. The middle column, for 25 lands, matches the numbers for 60-card decks shown at the beginning of this article. You could interpolate if you're in between.

| **Mana cost** | **Example spell** | **Number of colored sources required, 60-card deck** |

|  |  | **20 lands** | **25 lands** | **30 lands** |

| 5C | Drowner of Hope | 7 | 9 | 10 |

| 4C | Doubling Season | 8 | 9 | 11 |

| 3C | Collected Company | 9 | 10 | 12 |

| 2C | Reckless Stormseeker | 10 | 12 | 13 |

| 5CC | Hullbreaker Horror | 10 | 12 | 15 |

| 1C | Ledger Shredder | 11 | 13 | 14 |

| 4CC | Primeval Titan | 11 | 13 | 16 |

| C | Monastery Swiftspear | 12 | 14 | 15 |

| 3CC | Baneslayer Angel | 12 | 15 | 17 |

| 4CCC | Nyxbloom Ancient | 12 | 16 | 19 |

| 2CC | Wrath of God | 13 | 16 | 19  |

| 3CCC | Massacre Wurm | 14 | 17 | 20 |

| 1CC | Narset, Parter of Veils | 15 | 18 | 21 |

| 2CCC | Garruk, Primal Hunter | 15 | 19 | 22 |

| CC | Lord of Atlantis | 18 | 21 | 23 |

| 1CCC | Cryptic Command | 17 | 21 | 24 |

| 1CCCC | Unnatural Growth | 18 | 22 | 26 |

| CCC | Goblin Chainwhirler | 19 | 23 | 27 |

| CCCC | Dawn Elemental | 20 | 24 | 29 |

If you accept my model and its assumptions as useful, then you can do with fewer colored sources if you run very low land counts and you need more colored sources if you run very high land counts. Here, you can count every three or four cheap card draw or mana ramp spells in your deck as a land, cf. [my recent article on land counts](https://strategy.channelfireball.com/all-strategy/home/how-many-lands-do-you-need-in-your-deck-an-updated-analysis). Still, for the vast majority of decks (say, 60-card decks with 22 to 28 lands), you can safely use the table from the beginning of this article in the knowledge that you'll be very close.

## An example mana base: Rakdos Midrange in Pioneer

To see how to apply all of this, suppose we have selected the following spells for a 60-card deck, which corresponds to Marcio Carvalho's winning deck from a recent Pioneer Showcase Challenge.

- 4 Bloodtithe Harvester
- 4 Bonecrusher Giant
- 2 Chandra, Torch of Defiance
- 1 Cut // Ribbons
- 3 Dreadbore
- 4 Fable of the Mirror-Breaker
- 4 Fatal Push
- 1 Goblin Dark-Dwellers
- 4 Graveyard Trespasser
- 2 Kalitas, Traitor of Ghet
- 1 Shatterskull Smashing
- 1 Tenacious Underdog
- 4 Thoughtseize
- 1 Unlicensed Hearse

This is 36 cards, including one modal double-faced card. This means that we'll have 24 pure lands plus a modal double-faced card, which is a good amount. The question is which 24 lands to select. For this, we need to go over the cards one by one and look up their colored mana requirements in the 60-card table. We also need to scan the sideboard for potentially restrictive spells, and in this case it contains Rending Volley and Lifebane Zombie.

- Thoughtseize and Fatal Push require 14 untapped sources of black.
- Rending Volley from the sideboard requires 14 untapped sources of red if you plan to cast it on turn one. Depending on the metagame, this may not be a stringent requirement. For example, if your most likely target is Greasefang, Okiba Boss, then there's no need to have red mana immediately on turn one. But let's retain the 14 untapped sources requirement for now.
- Tenacious Underdog requires 13 sources of black.
- Bloodtithe Harvester and Dreadbore require 14 sources of black, 14 sources of red and 22 sources that are either red or black (requirements are increased by one because these are gold spells).
- Bonecrusher Giant and Fable of the Mirror-Breaker require 12 sources of red.
- Graveyard Trespasser requires 12 sources of black.
- Lifebane Zombie from the sideboard requires 18 sources of black.
- Chandra, Torch of Defiance requires 16 sources of red.
- Kalitas, Traitor of Ghet requires 16 sources of black.
- Goblin Dark-Dwellers requires 15 sources of red. If you suppose that you would typically cast Shatterskull Smashing for X=3, then it has the same requirement.
- Cut // Ribbons requires 13 sources of red. If you suppose that you cast the aftermath side typically for X=4, then that requires 13 sources of black.

Next we check the most constraining restrictions for all colors. This comes down to 16 sources of red and 18 sources of black, out of which 14 sources for each color should be available untapped on turn one. We also need 22 sources that are either red or black, but that'll be trivial if we're not running Mutavault or the like.

In terms of nonland sources, the deck runs some Treasure generation and card draw in the form of Fable of the Mirror-Breaker. I guess there's also the Blood token from Bloodtithe Harvester, but I wouldn't count that one because the card draw from the Blood token can only aid spells with mana value four or higher, and only if you crack the Blood token on turn three. That is unlikely to be a good play on that turn, so I wouldn't count on it.

Fable of the Mirror-Breaker, however, combines conditional Treasure generation from the first chapter and conditional card draw from the second chapter. If the chapters would have more reliably read "create a Treasure" and "draw two cards," then I could have counted four Fable of the Mirror Breaker as two sources of each color for spells costing four mana or more. Alas, the effects are more conditional, so I believe that counting the playset of Fables as approximately one source of red and one source of black for spells costing four mana or more is appropriate. Since the most restrictive red spell was Chandra, Torch of Defiance whereas the most restrictive black one was Lifebane Zombie, this means that we still need 15 sources of red and 18 sources of black from our lands, out of which 14 of each should be untapped for turn one. Now let's see the actual mana base from this sample deck.

- 4 Blightstep Pathway
- 4 Blood Crypt
- 1 Castle Locthwain
- 2 Den of the Bugbear
- 4 Haunted Ridge
- 2 Hive of the Eye Tyrant
- 2 Mountain
- 1 Shatterskull Smashing
- 1 Sokenzan, Crucible of Defiance
- 2 Swamp
- 1 Takenuma, Abandoned Mire
- 1 Urborg, Tomb of Yawgmoth

In this two-color deck, we can count Blightstep Pathway as a full source of red and a full source of black. Urborg, Tomb of Yawgmoth might count as more than one source of black for double-black spells, but let's be on the safe side for now and count it as a single source of black. As a result, we have 19 sources of black, out of which 14 are untapped for turn one, plus 18 sources of red, out of which 14 are untapped for turn one. This more than satisfies our constraints. In fact, we may be able to reduce our tap-land count if need be, for example by cutting one or two Haunted Ridge.

When choosing whether to, say, cut two Haunted Ridge for one Mountain and one Swamp, it becomes a trade-off between lower midgame colored mana consistency on the one hand (say, going from 98.5 percent to 97.4 percent for Chandra, Torch of Defiance or going from 94.8 percent to 92.5 percent for Lifebane Zombie) versus having lands enter the battlefield tapped slightly less often at inopportune times (as well as going from 91.3 percent to 93.2 percent for a turn-one Thoughtseize). In this case, I don't see a major issue with the total number of tap-lands. If I loosely count four Blood Crypt and one Shatterskull Smashing together as one tap-land because life points matter, two Den of the Bugbear and two Hive of the Eye Tyrant together as one-tap land because they're awkward draws in the late game, and four Haunted Ridge and one Castle Locthwain together as one tap-land because they could be annoying in land-light draws, then this mana base would function similar to one with three pure tap-lands, which is acceptable. Although I could still see cutting one Haunted Ridge for one Swamp to increase the likelihood of having untapped black mana on turn one, in the end it may be best to keep all of the (conditional) tap-lands and to enjoy the higher mid-game colored mana consistency.

Overall, this Rakdos Midrange mana base has a great mix between colored mana consistency, creature land utility and numbers of tapped lands. And a well-designed mana base is often an important step towards tournament success.
