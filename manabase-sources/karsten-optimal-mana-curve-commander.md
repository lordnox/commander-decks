# What's an Optimal Mana Curve and Land/Ramp Count for Commander?

- Author: Frank Karsten
- Original: https://www.tcgplayer.com/content/article/What-s-an-Optimal-Mana-Curve-and-Land-Ramp-Count-for-Commander/e22caad1-b04b-4f8a-951b-a41e9f08da14/
- Published: 2022-07-15T12:00:55Z
- Cached: 2026-09-13 from TCGplayer Infinite API (`/c/article/e22caad1-b04b-4f8a-951b-a41e9f08da14`)
- Note: Offline working copy for this repository. Copyright remains with the original author and publisher.

---

#

Building a Commander deck involves a lot of planning: crafting synergies, choosing cards, tweaking numbers and so on. One key aspect is making sure that you can consistently spend all your mana in an effective way. After all, if you don't spend the mana you have available on a given turn, then you don't get that mana back later on in the game.

To ensure you end up with a good mana curve (that is, a distribution of your spells over the various mana values) you should ask yourself questions like:

- "What's a good mix of lands, mana rocks, and other spells?"
- "How many spells of every mana value should I play?"
- "How does this depend on my Commander's mana value?"

In this article, I will answer these questions by providing handy frameworks based on mathematical modeling and optimization.

## Background: Optimal mana curves for 40-card and 60-card decks

In a 2020 article entitled ["What is an optimal mana curve?"](https://strategy.channelfireball.com/all-strategy/mtg/channelmagic-articles/what-is-an-optimal-mana-curve-for-decks-with-or-without-companions/), I proposed a simple model that enabled the determination of an optimal curve and corresponding land/spell count. In that model, a deck was comprised of one-drops, two-drops, three-drops, four-drops, five-drops and lands. Color requirements or the specifics of the cards were abstracted away. Under certain assumptions, I put forward the goal of optimizing the expected compounded mana spent over the course of the first seven turns, and the following deck compositions emerged as optimal.

| **Deck Type** | 1-drops | 2-drops | 3-drops | 4-drops | 5-drops | Lands |

| **40-card Limited deck** | 2 | 7 | 7 | 4 | 3 | 17 |

| **60-card Standard deck** | 3 | 10 | 10 | 7 | 4 | 26 |

These mana curves perfectly or nearly perfectly matched the average Limited and Standard decks at the 2020 World Championship. This indicated that the model and the optimization criterion was useful as a starting framework.

## Model extensions and adjustments for Commander

In that 2020 article, I also provided mana curves for Commander, but the model was not as useful for that format because it was missing several important aspects:

- **Free mulligan and always on the draw**: The official rules on the [Commander RC page](https://mtgcommander.net/index.php/rules/) or on [WotC's format page](https://magic.wizards.com/en/formats/commander) don't mention a free mulligan or a draw step for the starting player, which is why I've never used these rules in previous articles. Yet they're more than typical house rules. Comprehensive rule 103.4c says "In a multiplayer game and in any Brawl game, the first mulligan a player takes doesn't count toward the number of cards that player will put on the bottom of their library or the number of mulligans that player may take." And comprehensive rule 800.7 says "In a multiplayer game other than a Two-Headed Giant game, the starting player doesn't skip the draw step of their first turn." Accordingly, these rules should be part of any Commander analysis. I will also use them when updating other classic articles in the coming weeks/months, for example my analysis on the number of colored sources you need to consistently cast your spells.
- **The Commander as a free spell**: Players begin the game with a Commander in the command zone. Effectively, you're starting with an extra spell of a certain mana value in hand, which will influence your curve-outs.
- **Mana rocks and six-drops: **Some of the most popular cards in Commander are mana rocks, i.e., artifacts that tap for mana. Sol Ring and Arcane Signet are two very popular examples. Their presence can influence optimal mana curves and land counts, and they make it more realistic to ramp up to six-plus mana spells. Accordingly, mana rocks and six-drops deserve inclusion as separate card categories in my Commander deck model.

The above three aspects, which differentiate multiplayer Commander from single-player Limited or Standard, are all incorporated in the present article.

## Deck model, optimization criterion and assumptions

Although I already alluded to the deck model and optimization criterion, in this section I'll introduce them in more detail. To determine an "optimal" mana curve, we need a simple mathematical model of a deck, and we need to assign some kind weight to every possible deck - a criterion that allows us to rank decks from best to worst. Loosely speaking, this criterion should capture how efficiently you can spend your mana in the early-to-mid-game. Here, I have casual Commander games in mind; my model won't be useful for cEDH where players win on turn three with Vintage-level combo decks.

In terms of the deck model, I will consider a 99-card deck to be comprised of integer numbers of one-drops, two-drops, three-drops, four-drops, five-drops, six-drops, Arcane Signets and lands, plus one Sol Ring. Color requirements or the specifics of the cards are abstracted away, and all cards are supposed to be on-board effects. So, we don't care whether a three-drop is a Mayhem Devil, a Rhythm of the Wild, an Oko, Thief of Crowns or a Mirror Box - for the purpose of this analysis, it's a three-mana permanent with a blank text box. This stylized model is simple enough to keep the set of feasible decks manageable for optimization purposes, yet it's rich enough to produce useful insights.

In terms of the criterion, I will consider the expected compounded mana spent over the course of the first seven turns. This sums the total mana worth of on-board permanents other than mana rocks at the end of every turn. For example, suppose you mulligan into a terrible hand where your first play is a one-drop on turn three, followed by an Arcane Signet on turn four, your six-mana Commander on turn five and nothing else. Then the compounded mana spent over the course of the first seven turns would be one (on turn three) plus one (on turn four) plus seven (on turn five) plus seven (on turn six) plus seven (on turn seven). This sum of 23 describes how good the mana curve of this game was (it was pretty bad). This example represents one possible realization, but we're actually looking at the expectation over all possible games. By weighing each possible game according to the probability that it might occur, we obtain the expected compounded mana spent over the course of the first seven turns.

I estimated these criteria via Monte Carlo simulation, and I determined "optimal" decks via local search. You can find my Python code [here](https://github.com/frankkarsten/MTG-Math/blob/master/optimal_curve_commander.py). Further explanations and details on the mulligan policy, gameplay logic, justification of assumptions, and more can be found in the spoiler box below.

Mulligan policy, gameplay logic, etc

**Mulligan policy**: The first seven-card hand is kept if it has three, four or five lands and no more than five combined lands and Signets. Any hand with Sol Ring and one, two, three, four or five lands is kept as well. All other hands are mulliganed. The second seven-card hand is kept under the same conditions, with one difference: two-land hands are now kept as well. For a mulligan to six or five, after bottoming, we keep if we hold two, three or four lands or if we hold one land and a Sol Ring. For a mulligan to four, after bottoming, we always keep.

Bottoming is necessary for mulligans to six or lower. To that end, any Signets beyond the first are considered superfluous, so we start by bottoming superfluous Signets as much as necessary and possible. Afterwards, we bottom lands or spells depending on the mix in our hand, counting Sol Ring as a land that we never put on the bottom. Specifically, we try to get as close as possible to three lands. We first bottom lands until we have at most three lands remaining, and then we get rid of spells if we still must put more cards on the bottom. When we bottom spells this way, the most expensive ones are always bottomed first.

This mulligan policy was manually defined by me based on what seemed most reasonable and realistic. It need not be optimal. In fact, the specific composition of your deck should have a meaningful impact on your mulligan policy. Optimizing a mulligan policy for every possible deck can be done via stochastic dynamic programming, and while this would make for an interesting future research direction, it's outside the computational scope of this work.

**Gameplay logic**: On each turn, we start by playing a land if possible, and then we cast Sol Ring if possible. On turns one and two, we then cast an Arcane Signet if possible. After a turn one Sol Ring, we're done for the turn and can't cast anything else. Otherwise, on any turn, suppose at this point we have N mana available from lands and mana rocks. Then on turns three and four, we cast a mana rock and an N-1 drop if possible. Subsequently, on any turn, if we don't hold an N-drop but do hold a two-drop and a distinct N-2 drop, then we cast both of those spells. This is done so that, e.g., a two-drop and a three-drop is favored over casting a four-drop and wasting a mana.

Subsequently, on any turn, we play the highest mana value spell that we can cast, starting with six-drops, then five-drops, and so on, and we repeat this process until there's nothing we can cast anymore. At the end, if we notice that we have a mana leftover and could've snuck in a mana rock, then we do so retroactively.

This gameplay strategy was manually defined by me based on what seemed good to me. It need not be optimal, and the same comments as I made for the mulligan policy also apply here.

**Justification of the optimization criterion - expected compounded mana spent. **Games are usually won by whoever spends the most mana over the course of a game. If you curve out while the opposition is failing to affect the board, then you will usually win, and on-board advantages are compounded over time. The way I view the game of Magic, permanents generate some kind of advantage or value every turn, for example in the form of attacking creatures, planeswalker activations or valuable triggers, all measured by the card's mana cost, and that adds up every turn they stay on the battlefield.

To illustrate this way of thinking, a Lightning Greaves on turn two will contribute two mana per turn for the rest of the game. A Mayhem Devil on turn three will contribute three mana on turn three, three mana on turn four and so on. Likewise, a Parallel Lives will contribute four mana for every turn it stays on the battlefield, and a Venser, the Sojourner will contribute five mana per turn. In my experience, thinking in this way often leads to well-crafted Magic decks, which is why I find this criterion appealing.

**Justification of the optimization criterion - the relevant length of a typical game is seven turns.** Maybe it takes a few more turns for the game to truly end, but in my experience, usually one player will have an insurmountable board presence by turn seven, at least in Limited or Standard. In any case, the first seven turns represent the early-to-mid-game, which is the part of the game where curving out matters the most. And given that you generally start with seven cards in hand, if you play a land and a spell on every turn, then turn seven represents the last turn before you run out of cards. With these ideas in mind, I applied this turn seven assumption for Standard and Limited previously. For Commander, I watched the last five matches on [The Command Zone's Game Knights](https://www.youtube.com/playlist?list=PLyLzs6vB3Xk75kjIm45DQLrR8oT63_OvD) and saw that on average, the first player lost by turn eight or nine. This closely matched the [average game length in Limited](https://twitter.com/17lands/status/1422586080528797697), and therefore I kept the relevant game length for Commander the same as for single player 40-card or 60-card formats. Again, cEDH where players have Vintage-level turn-three combo decks is a different animal, and my work won't be very useful there.

**Permanents don't draw cards, tap for mana or act as mana sinks**: Real decks may play cards like Llanowar Elves, Beast Whisperer or Shalai, Voice of Plenty, and their abilities might influence your mana curve. However, given the computational limitations of simulation optimization, we must keep the model simple.

When applying my model framework to real decks, you may view Llanowar Elves as a combination of a mana rock and a one-drop, and you may view Beast Whisperer or Shalai as regular four-drops. However, if your deck contains a large number of card draw effects and/or mana sinks, then you may still be able to efficiently use your mana with one fewer five-drop and/or one fewer 6-drop than the tables in this article will indicate.

**Mana rocks don't contribute towards compounded mana spent**: Mana rocks are treated as lands that cost two mana to cast. If you have Arcane Signet on the battlefield, then it does not contribute two mana towards the compounded mana criterion. Indeed, it doesn't attack, block, or provide any beneficial triggers or abilities. Its value lies in letting your cast relevant N-drops, all of which do contribute towards the compounded mana criterion, more quickly.

**Six-drops count as 6.2 mana:** The power of spells tends to increase disproportionally beyond five mana. For example, in Limited you have vanilla 3/3s for three, vanilla 4/4s for four and vanilla 5/5s for five, but the classic six-drop is Colossal Dreadmaw, which has trample as a bonus. Which is fair because reaching six or more mana is not trivial and won't happen every game. It's a bit of guesswork, but based on 20+ years of competitive Magic experience, I pegged a six-drop as being worth 6.2 mana.

**We play against a goldfish:** Opponents are assumed to not interact, which also means that we never recast our Commander a second time. This assumption facilitates the analysis. Yet in real games, if a good curve-out forces opponents to spend mana to interact with us, then that means that this curve-out was still worthwhile.

**Mana rock modeling:** Our deck always contains one Sol Ring and an adjustable number of Arcane Signets. In real Commander decks, we can of course run only one actual Arcane Signet, but its effect is very similar to Three Visits, Signets, Talismans, Fellwar Stone, Nature's Lore and other Commander staples. They all reasonably modeled as an Arcane Signet for the purpose of this work.

I considered the addition of three-mana ramp spells like Cultivate or Kodama's Reach as a separate category, but I decided against that because an extra card type would complicate the optimization and gameplay logic considerably. Moreover, it would make the results applicable only to green decks, which wouldn't be right. If you would like to apply my model framework to real decks, then I'd view spells like Cultivate or Kodama's Reach as a combination of a mana rock and a three-drop.

**No color requirements or tapped lands**: Incorporating these features would make the model far too complicated. Instead, all lands are basically Command Towers. In reality, well-built mana bases generally shouldn't run into color screw very often and should limit the number of tapped lands, so I expect that the impact of this assumption is limited.

If your actual deck has a large number of tapped lands, then you may want to run slightly fewer one-drops than my results would suggest. That's because a tapped land is kind of like a one-drop, especially when you would often play such a land on the first turn of the game.

**All cards are on-board effects:** This assumption facilitates the analysis. But even interactive spells like Swords to Plowshares or counterspells could be seen as one-drops and two-drops, respectively, because subtracting something from the opposition is akin to adding to your own battlefield.

**No card draw spells**: Card draw spells or cantrips are not included in the model at the moment, but I did consider them. After all, cards like Brainstorm, Read the Bones, Harmonize and so on are popular inclusions, and a bunch of cheap cantrips could reduce your land count slightly. So initially, I incorporated card draw spells as an option. Unfortunately, in my first runs (which was based on four-mana Commanders), my optimization algorithm never chose to put Divination or Harmonize in the final deck. Given these initial results, I removed card draw spells from consideration altogether to speed up the optimization.

The fact that my optimization algorithm avoided Divination and Harmonize make sense because my simplified model ends on turn seven and has no specific cards, combos, colors or synergies to dig for. Nor does it feature sweepers or other spells that can regain lost tempo. In my model, casting Divination on turn six would often draw you into a three-drop and a superfluous land, in which case you would generally be better off by just drawing that three-drop instead of that Divination, and thus cutting Divination from the deck and adding a three-drop. In real Commander decks, card draw spells would be more valuable than my single-minded mana curve results suggest.

**Evaluation is via simulation:** In a model with nine different card types, the number of permutations of even the top 15 cards is astronomical, which means that exact evaluation using multivariate hypergeometric probabilities is not feasible. Instead, I used pseudo-random number generators to shuffle decks and simulate each deck's performance a bunch of times to estimate its expected compounded mana spent over the course of the first seven turns.

The number of simulations per deck was a function of the iteration that the optimization algorithm is currently in. I start in the first iteration with merely 10,000 simulations per deck in an attempt to quickly explore. In every iteration, I move to the best deck in the neighborhood, and then increase the number of simulations per deck by 1,000. If we have to reevaluate a deck that we've seen in one or more prior iterations, then we combine the simulations from the current iteration with the ones that have already taken place prior. These exact numbers of simulations were set mostly for practical reasons: to ensure that the algorithm would finish in hours rather than weeks or months.

**Optimization is via local search:** The number of possible decks is also astronomical, so exhaustive enumeration is not feasible. Instead, I used a basic local search heuristic: start at an initial reasonable solution (based on multiplications of optimal 40-card or 60-card decks) and then keep moving to better points in a neighborhood until no better point exists. If that is the case, then we have reached a local optimum. If the number of simulations for the current best deck at that time exceeds 200,000, we then stop and terminate the algorithm in the hope that it might also be a global optimum. I have no general concavity results, but based on deck building intuition, I expect the structure of the criterion function to be conducive to a local search heuristic.

The neighborhood in question, in the terminology of [Sklenar and Popela (2012)](https://www.researchgate.net/publication/220308491_Integer_simulation_based_optimization_by_local_search/fulltext/55db047c08ae9d6594921cc6/Integer-simulation-based-optimization-by-local-search.pdf), was a cross neighborhood at first and a star neighborhood at the end, plus the best deck from all previous iterations. The cross neighborhood, used when the number of simulations for the current best deck is less than 150,000, is all decks that are obtained by cutting at most one card and adding at most one card in total. For example, cut one two-drop and add one six-drop. When the best deck from the previous iteration, let's call it D, was simulated for at least 150,000 games, then we switch to the star neighborhood of D, which is all 99-card decks where the number of copies of any individual card type differs at most one from D. For example, cut a one-drop, a two-drop, and a three-drop and add a five-drop, a mana rock and a land.

**No guarantee of optimality:** Since I used simulation and local search, true optimality cannot be guaranteed. For some Commander mana values, repeated runs from different starting conditions gave the same results. But for most Commander mana values, I got very similar yet slightly different outcomes in different runs. In the latter case, I re-ran the algorithm at least three times and picked the deck with the highest criterion as the final optimum. I didn't run into these issues for the Standard/Limited models with six distinct card types, but moving to nine distinct card types in Commander exploded the difficulty. Based on observed decks changes across iterations, I don't think there is a major risk of getting stuck in a local optimum, but there is an issue with random variance, especially with Sol Ring in the mix.

Intuitively, when the neighborhood consists of hundreds of decks, it's quite likely that in the simulations, one of them is lucky enough to draw Sol Ring far more than average, which due to the power of that card would skew the results in that deck's favor, even if with infinite simulations it would turn out worse. While I understand the theory of simulation and optimization well enough to leisurely set up something fun, interesting and functional for Magic, it's not my specific area of expertise, and I'd say that this is currently one of the weaker parts of this study.

I considered several options to deal with this Sol Ring variance problem. First, I could delete Sol Ring from the model altogether, but that felt wrong because it's the most-played Commander card overall on EDHREC and because it directly influences curves and land count. Another approach would be to increase the sample size, but my computer was already running for several days, so there are practical limits. Perhaps optimizing the code by using something more clever than the random.shuffle method in Python or switching to a faster programming language could help, but it probably won't be the end-all either. Perhaps the most promising approach would be to use variance reduction techniques for rare event simulation, but I simply did not have the time available to familiarize myself with the underlying theory and to apply it to this problem. It's something to consider for future updates, though, and I am open to suggestions.

I also welcome any discourse on my various modeling assumptions, especially from players with more Commander experiences than me. [Twitter ](https://twitter.com/karsten_frank)is an easy way to reach me.

## Results: Optimal mana curves for 99-card decks

My simulation runs produced the following outcomes for various mana values of the Commander.

| **Commander** | **1-drops** | **2-drops** | **3-drops** | **4-drops** | **5-drops** | **6-drops** | **Mana rocks** | **Lands** |

| **2 mana** | 9 | 0 | 20 | 14 | 9 | 4 | Sol Ring + 0 Signet | 42 |

| **3 mana** | 8 | 19 | 0 | 16 | 10 | 3 | Sol Ring + 0 Signet | 42 |

| **4 mana** | 6 | 12 | 13 | 0 | 13 | 8 | Sol Ring + 7 Signet | 39 |

| **5 mana** | 6 | 12 | 10 | 13 | 0 | 10 | Sol Ring + 8 Signet | 39 |

| **6 mana** | 6 | 12 | 10 | 14 | 9 | 0 | Sol Ring + 9 Signet | 38 |

These mana curve frameworks are not only useful for new deck builders but also provide several general insights.

## Insight #1: Focus the bulk of your curve on two, three and four-drops

Looking at the optimal mana curves, it appears that the two, three and four-mana slots are where the majority of your spells should be. A limited number of one-mana and five-plus-mana spells are good as well, but having a balanced mixture of two, three and four-drops is most important. With such a curve, you will usually be able to spend all of your mana in the early-to-mid-game, and few mana will go to waste.

An underappreciated benefit of relatively cheap cards is that they also allow you to fill gaps in later turns. For example, if you cast a two-drop and a three-drop on turn five, then that still allows you to spend all your mana on that turn.

## Insight #2: The ideal curve depends on your Commander

If your Commander costs N mana, then the optimal deck in my simplified model contains zero N-drops. This makes sense: you already start the game with a free spell of that mana value, which results in a far lower need to fill that spot in your deck's mana curve.

In reality, spells are more than just blank cardboard with a mana value, and good deck building involves more than just maximizing the likelihood of curving out. So if there are spells of the same mana value as your Commander that synergize particularly well with your strategy, then by all means play them. Likewise, if your N-mana Commander has an enters-the-battlefield ability that is at its best when you cast it off-curve later in the game, then you also shouldn't cut every other N-drop from your deck.

So, most realistic decks with an N-mana Commander shouldn't go down to exactly zero N-drops. Nevertheless, it *is* wise to keep your commander's mana value in mind while crafting a mana curve. By running *fewer* cards of that cost than you otherwise might, you will be able to curve out more consistently.

## Insight #3: The ideal number of mana rocks depends on your Commander

The optimal deck for a two-mana or three-mana Commander, if you want to optimize your expected compounded mana until turn seven, consists of 42 lands, one Sol Ring and zero Signets. So for cheap Commanders, the optimizer decided that it was best to just curve out with a two-drop on turn two, a three-drop on turn three, and a four-drop on turn four. Fiddling around with mana ramp was worse.

Yet for four-mana, five-mana or six-mana Commanders, where you're guaranteed to have a spell worth ramping into, the optimizer found that it was better to lead with a mana rock on turn two, followed by a four-drop on turn three and a five-drop on turn four. The higher the mana value of your Commander, the more mana rocks you want, cf. the optimal deck configurations from the results table.

Even with expensive Commanders, it's important to strike a balance between mana rocks and lands. You can't just run infinite mana ramp spells and cut lands like there's no tomorrow. Indeed, when you get to turn four, if you miss your land drop and cast a mana rock instead, then that comes at a substantial tempo cost. In a way, lands are like mana rocks that cost zero mana.

If you take my idealized decks as an indication, then Commander decks with fewer than 38 lands and more than nine mana rocks may be better off by cutting a mana rock and adding a land. This may produce a better balance between ramping ahead and making your land drops.

That said, there can be many reasons to run more mana rocks than my simple model would suggest. For example, if you would expect to draw lots of cards in the midgame, say via someone's Windfall, then ramping ahead with mana rocks becomes more valuable. Or if someone might sweep the board with Blasphemous Act, then casting ramp spells would have been superior to committing creatures to the battlefield. Also, in multicolor decks, mana rocks can fix your mana and ensure you have enough colored sources in your deck. All of these are perfectly valid reasons to deviate.

## Insight #4: Play more lands!

I intend to dive deeper into the topic of land counts and how they should be a function of your average mana value and other deck-dependent factors in a later article. Yet my simple mana curve model also suggests land counts as an output, and they are probably higher than many Commander players would have expected.

In recent years, I have seen various deck building templates that recommend around 36 lands in Commander. Indeed, the typical land count on EDHREC, according to a recent article by Magic [Data Science](https://edhrec.com/articles/the-deck-of-many-things-card-frequencies-by-type-and-function-across-edh/), is 36. This would translate to 14.5 lands in 40-card decks or 21.8 lands in 60-card decks. Many Limited or Standard players would quickly recognize those numbers as a bad idea.

For Commander, based on the results of my simulations, my general advice would be to start with 42 lands plus a Sol Ring, then cut a land for every two or three additional mana rocks you add. You could also cut a land for every three or four cheap cantrips, such as Ponder or Brainstorm, and cut a land for every three or four mana dorks, such as Llanowar Elves or Birds of Paradise. But in general, for medium-power midrange Commander decks, try not to go below 37 lands. Missing your third or fourth land drop sucks, and you will stumble on lands far too often if you play fewer than 37 lands.

"But", you might ask, "should we really base land counts on a simple, idealized simulation model with a narrow-minded criterion and a bunch of assumptions?" Well, no, you certainly shouldn't take any such model as gospel. Yet I can provide two supporting arguments in support of higher land counts. First, higher land counts are in line with what many builders of Pro Tour-winning decks would suggest based on decades of competitive Magic experience. See, for example, [Reid Duke's argument that "your land count is too low"](https://strategy.channelfireball.com/all-strategy/home/your-land-count-is-too-low-strategy-highlight/) and [Sam Black's claim that "40 is a good minimum [in Commander]."](https://twitter.com/SamuelHBlack/status/1297948399745015808) Second, the model I used in this article resulted in 17 lands for 40-card decks and 26 lands for 60-card decks, which perfectly matched successful tournament decks. This adds credibility to the results.

A few years ago, 24 lands may have been more typical for 60-card decks, but that was before we were bombarded with high-quality creature-lands, cycling lands and channel lands. There are now also modal double-faced cards that you may count as half-spell, half-land. In 2022 Magic, few games are lost to mana flood, but you're heavily punished for missing land drops because there's an abundance of permanents that provide powerful, snowballing advantages as long as they stay on the battlefield. I have been finding success in tournaments this year with 24 or 25 lands in 60-card *aggro* decks. For 60-card *midrange* decks, 26 lands really is the standard now.

"But", you might continue, "Commander has a free mulligan, you're always on the draw, and you have a bunch of mana rocks. Also, if you're behind on lands, then people will generally go after others and leave you be for a bit." As for the first three aspects, those are already considered in my model. Just like the fact that you also start the game with a free, mana-hungry Commander in the command zone, which pulls ideal land counts in the other direction. As for the leave-you-be argument, I concede that mana issues may be less punishing in casual multiplayer formats than in competitive single-player formats. Yet for a casual-oriented format, being mana screwed seems like the opposite of fun. Casting spells is fun! Why would you willingly deprive yourself of that?

If, after all this, you're still hesitant about the idea of cutting fun spells for lands, then remember all the lands with activated abilities: creature-lands like Creeping Tar Pit, cycling lands like Forgotten Cave, channel lands like Otawara, Soaring City, utility lands like Rogue's Passage and so on. In recent years, Wizards of the Coast has provided so many fantastic lands to support higher land counts, and you would do well to exploit them. Modal double-faced cards like Bala Ged Recovery or Valakut Awakening can roughly count as half-spell, half-land as well.

## Insight #5: Small deviations from the ideal curve are perfectly fine

Although I didn't provide numbers for other decks in the results table, I can tell you that the differences between decks that are close to the listed optimum are miniscule. For example, the expected compounded mana spent over the first seven turns for the mana curve listed as optimal for four-mana Commanders in the table was 72.465. If you were to look at a similar deck obtained by cutting a one-drop, a two-drop and a three-drop and adding a five-drop, a six-drop and an Arcane Signet, then its criterion would be 72.434. That's 99.96 percent of optimal!

Because the differences are this small and due to the nature of simulation-based heuristic optimization with limited sample sizes, I can't guarantee that the decks in the table are truly optimal, even if you fully accept my model and assumptions. The mana curves I presented are almost surely *close* to optimal. But small deviations are almost imperceptible, which means that decks with similar mana curves could be just as good in practice.

However, if you were to make more massive changes, such as cutting six six-drops and adding six one-drops, or cutting six lands and adding six three-drops, then you'd notice a real difference. Such massive deviations to the aforementioned optimal deck would result in criteria that are about 98 percent of optimal, which is a significant difference. Unless you have good deck building reasons, I would caution against deviating *too* much from the "optimal" mana curves.

Fortunately, and this is part of why I love Magic so much, there can be loads of good deck building reasons to deviate from any given framework. Indeed, the real answer to any of the questions I asked in the introduction of this article is "it depends." For example, aggro decks should have lower curves and control decks require higher curves. Moreover, no two Commander decks are alike. Every different Commander or strategy allows you to express yourself and will influence what your perfect mana curve should look like.

In the end, the mana curve tables presented in this article come from an idealized model, intended as a simplified abstraction where we only care about curving out, under a plethora of assumptions. Yet I hope that due to their simplicity and elegance, the results will prove useful as a starting template for new deck builders. If your deck is reasonably close to them, then I am confident that you will be able to use your mana more efficiently and have more fun in your Commander games. Thank you for reading, and good luck!
