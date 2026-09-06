# Dumpster-Diver Crab — agent hints

Primer owns the plan. This file is the seat checklist.

## Always ask

1. How many Homers, how many total seafood permanents (including creatures
   affected by type-changers), how many **additional-trigger** permanents, and
   how many lands will enter this turn?
2. What is the largest legal landfall line from the current hand? Expand every
   search: list the lands Scapeshift or another effect can find, then count
   fetch cracks, automatic Hideout-style sacrifices, Glaciers, bounce lands,
   Harrow, and Dreamscape Artist as additional entries.
3. Compute exact mill per opponent as
   `2 × land entries × Homers × seafood × (1 + additional-trigger effects)`.
   Compare it with the largest opposing library. If it reaches that number,
   take the win before considering a setup or value permanent.
4. Should this trigger hit only us (still stocking) or **every opponent**
   (lethal or close)? Homer targets any number of players and does not
   split X among them.
5. Is Roaming Throne, Virtue of Knowledge, Yarok, or Ancient Greenwarden
   in hand or already in play and unused in the count?

## Sequencing

- Cast Homer on curve when the three colors are there. Early triggers may
  target only this seat.
- A clone that ignores the legend rule is better than a second legendary
  Homer.
- **Virtue of Knowledge** (and Yarok / Greenwarden / Throne) each add one
  landfall instance per Homer. Two Homers plus Virtue is four instances,
  not two.
- Roaming Throne names **Crab**: it becomes seafood and adds a trigger.
  Cast it the turn it is drawn if the mana is there.
- Land drop order: put the extra-entry land onto the battlefield **before**
  dumping a basic. Misty Rainforest as the drop, then crack it, then
  activate Thawing Glaciers, is three landfall events.
- Scapeshift is a search tree, not only one entry per sacrificed land. With
  one Homer and Roaming Throne, play Forest, sacrifice six lands, find six
  lands including four fetches, then crack all four: eleven entries mill each
  opponent for 88. Verify enough legal fetch targets remain, then take this
  line whenever it empties every opposing library.
- Do not mill this seat once outward mill can kill. Point lethal triggers
  at opponents only.

## Combat

Homer almost never attacks. Skip combat unless a clone with evasion is
the actual clock.

## Closing

Count the exact mill against remaining library sizes before passing.
A Forest while a fetch and Glaciers are sitting unused is a miss.
