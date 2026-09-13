# How Many Lands Do You Need in Your Deck? An Updated Analysis

- Author: Frank Karsten
- Original: https://www.tcgplayer.com/content/article/How-Many-Lands-Do-You-Need-in-Your-Deck-An-Updated-Analysis/cd1c1a24-d439-4a8e-b369-b936edb0b38a/
- Published: 2022-07-29T12:00:19Z
- Cached: 2026-09-13 from TCGplayer Infinite API (`/c/article/cd1c1a24-d439-4a8e-b369-b936edb0b38a`)
- Note: Offline working copy for this repository. Copyright remains with the original author and publisher.

---

#

Ever since the release of the first Magic set, deck builders have been captivated by the question of how many lands to play. Back in the '90s, I often heard the recommendation to build a deck with a third creatures, a third noncreature spells and a third lands. But deck building insights have made great strides since then. Nowadays, recognizing the danger of mana screw, decks often contain far more lands. But how much do you need, and how does this depend on the composition of your deck?

In this article, based on a regression analysis of over 95,000 successful tournament decks, I will provide useful formulas that can help you choose the numbers of lands for your deck. The TL;DR summary is:

- A non-mythic land/spell MDFC, such as Jwari Disruption or Kazandu Mammoth, counts as 0.38 land. A mythic land/spell MDFC, such as Emeria's Call, counts as 0.74 land.
- A good formula for the number of lands in your 60-card deck, counting MDFCs partially in this fashion, is: 19.59 + 1.90 * average mana value of your spells – 0.28 * number of cheap card draw or mana ramp spells + 0.27 if you have a companion. This means that if your average mana value is three, which is fairly typical, then you should start with 25 or 26 lands and cut one land for every three or four cheap card draw or mana ramp spells in your deck.
- A good formula for the number of lands in your 99-card deck, counting MDFCs partially in this fashion, is: 31.42 + 3.13 * average mana value of your spells – 0.28 * number of cheap card draw or mana ramp spells. This means that if your average mana value is three, which is fairly typical, then you should start with 40 or 41 lands and cut one land for every three or four cheap card draw or mana ramp spells in your deck.

[](https://channelfireball.com/magic_the_gathering)

Before diving into the details, I should mention that I tackled the topic of land counts in [an article two years ago](https://strategy.channelfireball.com/all-strategy/mtg/channelmagic-articles/how-many-lands-do-you-need-in-a-60-card-deck-or-80-card-deck/), but the present article differs in four important ways:

- I explicitly incorporate the number of mana ramp or card draw spells in the regression analysis.
- I consider the impact of the land/spell modal double-faced cards, such as Jwari Disruption, which did not exist two years ago.
- I consider a far larger data set (more than a thousand times larger) from a variety of formats.
- I only consider decks from events that were held after the [companion rules change](https://magic.wizards.com/en/articles/archive/news/june-1-2020-banned-and-restricted-announcement).

Also, in a recent article, I determined an [optimal mana curve and land/ramp count for Commander](https://strategy.channelfireball.com/all-strategy/home/whats-an-optimal-mana-curve-and-land-ramp-count-for-commander/). This work optimized the mana curve and the land/ramp count simultaneously to present a general framework for midrange decks. In reality, however, every deck is different. If your average mana value is rather low (say, a fast aggro deck) or rather high (say, a slow control deck) or if you have unusually low or high numbers of mana ramp or card draw spells, then you'll want to know how to adjust. The present article helps in that regard. Also, it's based on data analysis rather than stochastic modeling.

_Header - The Data Set_

I scraped all 60-card decks that were played in events on MTG Melee and on Magic Online between July 1, 2020 and July 1, 2022 with more wins than losses. That's two full years of data! I excluded any deck whose number of match wins did not exceed its number of match losses, as well as outliers with fewer than 11 cards in the sideboard, more than 20 cheap card draw spells in the main deck, an average mana value of six or greater, fewer than 11 lands, more than 40 lands, all Vintage decks and/or decks with cards (such as "Chandra, Torch of Defiance Emblem" or "Magnifying Glass Enthusiast") that Scryfall didn't recognize as legal inclusions. This yielded a set of 95,143 successful tournament decks. I made the dataset available publicly on [Kaggle](https://www.kaggle.com/datasets/frankkarsten/mtg-lands).

For each main deck - sideboards were disregarded - I determined:

- **The number of lands**. This number excludes land/spell MDFCs.
- **The average mana value**. This is determined by summing the mana value of all nonland cards and dividing by the total number of nonland cards in the deck. Land/spell MDFCs are counted as their front side (i.e., as nonland cards) because that is also what MTG Arena does when determining a deck's average mana value.
- **The number of cheap card draw spells**. I defined a "cheap card draw spell" as a nonland card with mana value two or less whose lowercase Oracle text contains "draw a card", "draw two cards", "draw three cards", "draws cards", "draws two cards" or "draws three cards", but not "{4}", "Blood token" and/or "investigate." Additionally, if it's a creature, then its Oracle text also needs to contain "when" and "enters." A noncreature spell with mana value two or less and the words "look", "library", "put" and "your hand" but not "pay " or "pays" also counts as a "cheap card draw spell." Finally, any spell that cycles for one mana also classifies as a "cheap card draw spell". This lengthy definition means that the likes of Brainstorm, Faithless Looting, Deadly Dispute, Omen of the Sea, Growth Spiral, Drannith Stinger, Expressive Iteration, Manamorphose, Ice-Fang Coatl, etcetera are included, but Augur of Bolas, Trail of Crumbs, Esper Sentinel, Fateful Absence, Ledger Shredder, Edgewall Innkeeper, Improbable Alliance, Ox of Agonas, Bloodtithe Harvester, Shark Typhoon, Hydroid Krasis or Ravenous Squirrel are not.
- **The number of cheap mana ramp spells. **I defined a "cheap mana ramp spell" as a nonland card with mana value two or less that is not already a "cheap card draw spell" and whose oracle text contains "add ", but not "add its ability", "add a lore counter" or, in case of a creature, "dies." This includes Llanowar Elves, Skirk Prospector, Springleaf Drum, Lotus Cobra, Dark Ritual, etcetera, but not Ranger Class, Tangled Florahedron, Shambling Ghast or Manamorphose. A nonland card with mana value two or less that is not already a "cheap card draw spell" was also classified as a "cheap mana ramp spell" if its Oracle text contained either of the following three options: first, "search" and "your library" and ("land" or "basic") but not "sacrifice." Second, "enchanted land is tapped" and "adds an additional." Third, "put a creature card with" and "from your hand onto the battlefield." This includes Sylvan Scrying, Wolfwillow Haven and Aether Vial, but not Crop Rotation.
- **The presence of a companion in the sideboard. **This Boolean characteristic was based on self-reported companion slots or on a quick scan of the sideboard contents, not on a thorough check of whether a deck indeed matched all requirements for a one-of companion creature in the sideboard.

Having determined all this, I then applied multiple least-squares [linear regression](https://en.wikipedia.org/wiki/Linear_regression) to model the relationship between the number of lands in the deck and the other four independent variables as described above. To implement this, I used the sklearn.linear_model.LinearRegression tool from Python on 95% of the data, leaving five percent as a test set.

_Header - Modal Double-Faced Cards_

A first question I wanted to answer was how to count modal double-faced cards (MDFCs).

To that end, I first built a multiple regression model on all decks with zero MDFCs. This yielded a linear formula that could associate a deck's average mana value, number of cheap card draw spells, number of cheap mana ramp spells and its companion count with a predicted land count. I then used this formula on the set of decks with one or more MDFCs, subtracted the actual pure land count to obtain the difference and ran a zero-intercept regression. In this regression, I used the number of mythic and non-mythic land/spell MDFCs as independent variables to predict the difference.

The result was:

- A non-mythic land/spell MDFC, such as Jwari Disruption or Kazandu Mammoth, counts as 0.38 land.
- A mythic land/spell MDFC, such as Emeria's Call, counts as 0.74 land.

These numbers are quite close to the [rules of thumb](https://strategy.channelfireball.com/all-strategy/mtg/channelmagic-articles/mana-bases-with-zendikar-risings-modal-double-faced-cards/) I proposed when these cards were first released. Back then, I suggested counting a non-mythic land/spell MDFC as half land, half spell, and I suggested counting a mythic land/spell MDFC (whose ability to enter untapped makes them closer to an actual land) as three-quarters land, one-quarter spell. Yet it's nice to see the actual data on this.

Afterwards, I added a new column to my data set: the number of lands, counting MDFCs partially according to the numbers listed above. For example, a deck with 21 pure lands, four Kazandu Mammoth and four Shatterskull Smashing was then treated as a deck with 25.48 lands.

_Header - Results for 60-Card Decks_

Having incorporated MDFCs, I went back to the complete data set and ran another linear regression. As the coefficients for cheap card draw and cheap mana ramp were extremely similar, I combined the two into a single feature. The resulting overall regression and all coefficients were statistically significant at p < .0001, and the model had an R-squared value of 0.395 with a root mean square error of 2.75. Not great, not terrible. Here's the fitted model:

`**Number of lands, counting MDFCs partially** = 19.59 + 1.90 * average mana value – 0.28 * number of cheap card draw or mana ramp spells + 0.27 * companion count.`

In this formula, 'companion count' should be zero or one. For the land count, you can treat a non-mythic land/spell MDFC as 0.38 lands and a mythic land/spell MDFC as 0.74 land.

As an example on how to use this, consider a Boros Aggro deck on MTG Arena. By clicking the "more details" button, you get a quick overview of the mana curve, including the average mana value of 2.2.

[](https://mktg-assets.tcgplayer.com/content/channel-fireball/article-images/2022/07/Boros-Aggro-land-count-example.png)

Since the deck has no cheap card draw or mana ramp spells and zero companions, filling in the formula yields 19.59 + 1.90 * 2.2 = 23.77 lands. If there had been cheap card draw or mana ramp spells, then you'd cut a land for every 3-4 such spells (specifically, 0.28 lands per such spell). And if there had been a companion, which increases your appetite for mana by granting a free spell to your opening hand, then you would have added 0.27 lands. In any case, the actual Boros Aggro version that I based this example on had neither of these things and ran 23 lands, which is close enough to the predicted amount. Perhaps the scry ability on Play with Fire, while not an actual card draw spell, can still help you find lands sometimes, which means that it's fine to round down the land count.

As another example, consider an Esper Midrange deck on MTG Arena. By clicking the "more details" button, you get a quick overview of the mana curve, including the average mana value of 2.9.

[](https://mktg-assets.tcgplayer.com/content/channel-fireball/article-images/2022/07/Esper-Midrange-land-count-example.png)

Since the deck has no cheap card draw or mana ramp spells and zero companions, filling in the formula yields 19.59 + 1.90 * 2.9 = 25.10 lands. That's less than in the actual Esper Midrange version that I based this example on: 26.74 land, including a singleton Emeria's Call.

There are several logical reasons for this discrepancy. First, the actual mana value doesn't always fully reflect a card's appetite for mana - The Meathook Massacre generally costs more than two mana, Tenacious Underdog provides a late-game mana sink thanks to its blitz ability and Legion Angel is also more mana-intensive than a typical four-drop. As a result, the effective average mana value of this Esper Midrange deck will be slightly higher in practice. Second, since this is a three-color deck, there are heavy colored mana requirements, which in turn inflate the required land counts. Third, the mana base contains several utility lands, such as Eiganjo, Seat of the Empire, Hive of the Eye Tyrant and Raffine's Tower, all of which support higher land counts.

These examples show that the land count formula is not perfect - Magic is too complex for that. Nevertheless, I believe it'll be useful as a starting point for new deck builders. Especially once you understand through examples how the specifics of your deck could result in slightly lower or slightly higher land counts.

_Header - Ramp vs Card Draw Spells_

Another aspect that is not captured in the land count formula is the difference between the various mana ramp and card draw spells. They're not all made equal. Ponder and Consider, for example, are reasonably efficient at reducing your land count because they only cost one mana and dig fairly deep. Two-mana cantrips like Ice-Fang Coatl or Spreading Seas, on the other hand, are far worse in comparison.

Likewise, mana rocks like Springleaf Drum or Coldsteel Heart are fairly reliable, and the same goes for land search effects like Sylvan Scrying. On the other hand, Llanowar Elves or Lotus Cobra frequently die to a creature removal spell before they can add mana.

So, be smart and make some adjustments based on the actual effects of your cards. Are they more efficient and/or more reliable than the average? Then perhaps you can cut a land for every two or three such cards. Are they less efficient and/or less reliable than the average? Then play it safe and only cut a land for every four or five such cards.

_Header - 80-99-Card Decks_

I don't have as much data on deck sizes other than 60 cards, and especially for Commander it's hard to find data on a deck's performance. Yet we can easily port the 60-card formula over to 80-card Yorion decks by multiplying all numbers, other than the number of cheap card draw/mana ramp spells, by 80/60 and by setting the companion count to 1. This won't be exact because larger deck sizes are always associated with higher risks of mana screw or mana flood, but it'll be close enough.

`**Number of lands for an 80-card deck, counting MDFCs partially** = 80/60 * (19.59 + 1.90 * average mana value + 0.27) – 0.28 * number of cheap card draw or mana ramp spells`

For Commander, we could use a similar formula, but it wouldn't take into account the free mulligan or the free draw on turn one. One way to get a sense of their impact is by looking at the results from my aforementioned analysis on [an optimal mana curve and land/ramp count](https://strategy.channelfireball.com/all-strategy/home/whats-an-optimal-mana-curve-and-land-ramp-count-for-commander/). There, I found that 26 lands was optimal for 60-card decks without a companion, which would translate to (26 + 0.27) * 99/60 = 43.35 lands for Commander decks if I count the commander as a pseudo-companion. Yet the optimal Commander decks for cheap commanders contained 42 lands. This suggests that if we port 60-card formulas to 99-card decks, then we should reduce the resulting land count by 1.35 lands to account for the free mulligan and the free draw on turn one. I emphasize that this is an imprecise back-of-the-envelope estimate, but it provides a useful starting point, and it's in line with my deck building intuition. It results in the following formula.

`**Number of lands for an 99-card deck, counting MDFCs partially** `

`= 99/60 * (19.59 + 1.90 * average mana value + 0.27) – 0.28 * number of cheap card draw or mana ramp spells - 1.35 `

`= 31.42 + 3.13 * average mana value of your spells – 0.28 * number of cheap card draw or mana ramp spells`

_Header - Ideas for Future Research_

Although the linear regression model has the advantage of simplicity, it is probably not the most accurate one. Within machine learning, there are plenty of alternative algorithms that one could consider, such as decision trees, k-nearest neighbor, random forests, etc. The results would be far harder to put into an easy-to-apply formula for Magic deck building, but it would be interesting to study alternative algorithms.

Even if we were to stick to multiple regression for simplicity, a more detailed investigation of the various features could prove useful. For example, does the Constructed format or the number of wins of a deck have some impact on the land counts? Could we grab more fine-grained characteristics of the deck, such as the mana curve distribution or the specifics of the card draw or mana ramp spells? How about the number of utility lands or the number of colors in a deck? There's a treasure trove of information, and there's still much to learn.
