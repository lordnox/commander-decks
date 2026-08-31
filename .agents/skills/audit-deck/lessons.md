# Audit-deck lessons

Oracle and Scryfall win over memory. These are failure modes this skill exists to catch.

## Packages, not vibes

The request "a strange card that handles multiple things" includes two-card engines. The example is **not** a default include:

- [Vanish into Memory](https://scryfall.com/card/c14/172/vanish-into-memory) exile a creature, draw cards equal to its power, then return it and discard equal to its toughness.
- [Wall of Blood](https://scryfall.com/card/mrd/82/wall-of-blood) pay 1 life: +1/+1 until end of turn, no cap.

Together that is instant-speed life-for-cards (a Necropotence-shaped line) if the Wall is the target. It is illegal or useless in a deck that cannot host both cards, does not want to spend life, or already has a better draw engine. Hunt that *shape* in the current identity: two existing jobs that one old card, or one pair, can fuse.

A package whose halves are dead alone usually loses to two independent cards.

## Do not upgrade rate

Replacing a three-mana on-theme thief with a two-mana generic one fails the house rules even if the generic card is stronger. `## Cards in` states the job a replacement must keep doing; "strictly better" is not the job.

## Prior cuts stay cut

`## Cards out` is the memory. Re-proposing Agatha's Soul Cauldron, Sol Ring, or a card cut last session needs new Oracle or a changed 99, not a second opinion.

## Commander math

Copying a legendary commander does not create a second attacker unless the copy drops legendary. Linked exile abilities return only the card *that object* exiled. Replacement-draw enchantments (Shared Fate) change what "you may draw a card" means; verify both branches.

## Game Changers and staples

Query `is:gamechanger` live. Zero unless this deck is excepted. `Necropotence` is a Game Changer; a kitchen-table analogue is not a license to add it. Staples still need a specific argument.
