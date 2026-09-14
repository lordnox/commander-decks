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

Query `is:gamechanger` live and still disclose official status. Inclusion follows root `DECISIONS.md`: argue the usage, do not auto-veto. A Game Changer that only adds speed, consistency, or a free answer stays out. Permanent fast mana is 4+ here; one-shot rituals can be 3+. Staples are flour: lands and two-mana rocks are exempt, and no card is blacklisted by name. An on-theme Chaos Warp, Dark Ritual, or free spell is fine when the line can be named in a sentence; the same card taken as the strongest generic option is not. Rhystic Study, Smothering Tithe, and free counterspells held as protection are the shape to reject. A powerful card run for its drawback or lose-the-game clause usually lowers the deck's power, so do not score it as a promotion.
