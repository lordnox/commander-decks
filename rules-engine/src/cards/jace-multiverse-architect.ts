import type { CatalogEntry, ScryfallCardData } from './types'
import { snapshotFor } from './snapshot'
import {
  activated,
  banAttacks,
  choice,
  chooseCards,
  draw,
  manaCost,
  minusLoyalty,
  move,
  objects,
  payOptional,
  plusLoyalty,
  players,
  ref,
  revealUntil,
  REVEAL_UNTIL_REST,
  select,
  stepBegins,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'


// Copied from the shared Scryfall cache; source retrieval date is unknown.
// Rules fields verified against Scryfall on 2026-10-23.
const scryfall = {
  "object": "card",
  "id": "55cd03d9-2535-4cf3-a8b2-1418e1190f4a",
  "oracle_id": "3321c134-bf5b-4f63-8035-fca0bbdfa86b",
  "multiverse_ids": [],
  "resource_id": "00637D1CB78FAEBEF5BCD1D6AF0D93438A3C7C3CCAFD529BD6C7AE7D0E0204C3",
  "mtgo_id": 156398,
  "tcgplayer_id": 718671,
  "cardmarket_id": 909794,
  "name": "Jace, Multiverse Architect",
  "lang": "en",
  "released_at": "2026-10-02",
  "uri": "https://api.scryfall.com/cards/55cd03d9-2535-4cf3-a8b2-1418e1190f4a",
  "scryfall_uri": "https://scryfall.com/card/frc/1/jace-multiverse-architect?utm_source=api",
  "layout": "normal",
  "highres_image": true,
  "image_status": "highres_scan",
  "image_updated_at": "2026-09-17T11:25:16Z",
  "image_uris": {
    "small": "https://cards.scryfall.io/small/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.jpg?1789644316",
    "normal": "https://cards.scryfall.io/normal/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.jpg?1789644316",
    "large": "https://cards.scryfall.io/large/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.jpg?1789644316",
    "png": "https://cards.scryfall.io/png/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.png?1789644316",
    "art_crop": "https://cards.scryfall.io/art_crop/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.jpg?1789644316",
    "border_crop": "https://cards.scryfall.io/border_crop/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.jpg?1789644316",
    "thumb": "https://cards.scryfall.io/thumb/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.webp?1789644316",
    "grid": "https://cards.scryfall.io/grid/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.webp?1789644316",
    "display": "https://cards.scryfall.io/display/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.webp?1789644316",
    "art": "https://cards.scryfall.io/art/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.webp?1789644316",
    "crop": "https://cards.scryfall.io/crop/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.webp?1789644316",
    "jpeg": "https://cards.scryfall.io/normal/front/5/5/55cd03d9-2535-4cf3-a8b2-1418e1190f4a.jpg?1789644316"
  },
  "mana_cost": "{1}{W}{U}{B}{R}",
  "cmc": 5.0,
  "type_line": "Legendary Planeswalker — Jace",
  "oracle_text": "At the beginning of combat on each opponent's turn, they may pay {2}. If they don't, creatures they control can't attack Jaces you control this turn.\n+1: Draw two cards, then put a card from your hand on the bottom of your library.\n−3: Exile another target planeswalker or creature you control. Reveal cards from the top of your library until you reveal a creature or planeswalker card. Put that card onto the battlefield and the rest on the bottom of your library in a random order.\nJace, Multiverse Architect can be your commander.",
  "loyalty": "4",
  "colors": [
    "B",
    "R",
    "U",
    "W"
  ],
  "color_identity": [
    "B",
    "R",
    "U",
    "W"
  ],
  "keywords": [],
  "legalities": {
    "standard": "not_legal",
    "future": "not_legal",
    "historic": "legal",
    "timeless": "legal",
    "gladiator": "legal",
    "pioneer": "not_legal",
    "modern": "not_legal",
    "legacy": "legal",
    "pauper": "not_legal",
    "vintage": "legal",
    "penny": "not_legal",
    "commander": "legal",
    "oathbreaker": "legal",
    "standardbrawl": "not_legal",
    "brawl": "legal",
    "competitivebrawl": "legal",
    "alchemy": "not_legal",
    "paupercommander": "not_legal",
    "duel": "legal",
    "oldschool": "not_legal",
    "premodern": "not_legal",
    "predh": "not_legal",
    "tlr": "not_legal"
  },
  "games": [
    "paper",
    "mtgo",
    "arena"
  ],
  "reserved": false,
  "game_changer": false,
  "foil": true,
  "nonfoil": true,
  "finishes": [
    "nonfoil",
    "foil"
  ],
  "oversized": false,
  "promo": false,
  "reprint": false,
  "variation": false,
  "set_id": "cfd10490-7397-4143-bda7-d388b877636f",
  "set": "frc",
  "set_name": "Reality Fracture Commander",
  "set_type": "commander",
  "set_uri": "https://api.scryfall.com/sets/cfd10490-7397-4143-bda7-d388b877636f",
  "set_search_uri": "https://api.scryfall.com/cards/search?order=set&q=e%3Afrc&unique=prints",
  "scryfall_set_uri": "https://scryfall.com/sets/frc?utm_source=api",
  "rulings_uri": "https://api.scryfall.com/cards/55cd03d9-2535-4cf3-a8b2-1418e1190f4a/rulings",
  "prints_search_uri": "https://api.scryfall.com/cards/search?order=released&q=oracleid%3A3321c134-bf5b-4f63-8035-fca0bbdfa86b&unique=prints",
  "collector_number": "1",
  "digital": false,
  "rarity": "mythic",
  "card_back_id": "0aeebaf5-8c7d-4636-9e82-8c27447861f7",
  "artist": "Volkan Baǵa",
  "artist_ids": [
    "93bec3c0-0260-4d31-8064-5d01efb4153f"
  ],
  "illustration_id": "af828d10-92e5-40e8-90e4-f88b1b87ef96",
  "border_color": "borderless",
  "frame": "2015",
  "security_stamp": "oval",
  "full_art": false,
  "textless": false,
  "booster": false,
  "story_spotlight": false,
  "edhrec_rank": 8349,
  "preview": {
    "source": "Wizards of the Coast",
    "source_uri": "https://youtu.be/mvTyHbTbfBo",
    "previewed_at": "2026-09-16"
  },
  "prices": {
    "usd": "1.10",
    "usd_foil": "1.17",
    "usd_etched": null,
    "eur": "0.68",
    "eur_foil": "0.52",
    "tix": "2.00"
  },
  "related_uris": {
    "tcgplayer_infinite_articles": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Farticles&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Farticles%3FproductLineName%3Dmagic%26q%3DJace%252C%2BMultiverse%2BArchitect",
    "tcgplayer_infinite_decks": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Fdecks&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fdecks%3FproductLineName%3Dmagic%26q%3DJace%252C%2BMultiverse%2BArchitect",
    "edhrec": "https://edhrec.com/route/?cc=Jace%2C+Multiverse+Architect"
  },
  "purchase_uris": {
    "tcgplayer": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F718671%3Fpage%3D1",
    "cardmarket": "https://www.cardmarket.com/en/Magic/Products?idProduct=909794&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall",
    "cardhoarder": "https://www.cardhoarder.com/cards/156398?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall"
  }
} satisfies ScryfallCardData

const typeLine = scryfall.type_line.split(' — ')
export default {
  scryfall,
  types: ['Planeswalker'],
  supertypes: ['Legendary'],
  subtypes: typeLine[1]?.split(' ') ?? [],
  colors: scryfall.colors,
  manaCost: scryfall.mana_cost,
  manaValue: scryfall.cmc,
  printedLoyalty: Number(scryfall.loyalty),
  ruleDefinition: snapshotFor([
    whenever(stepBegins({ step: 'beginCombat', player: players({ relation: 'opponent' }) }), {
      instructions: [payOptional({
        payer: ref('triggering.player'),
        cost: manaCost('{2}'),
        bindResult: 'paid',
        ifDeclined: [banAttacks({
          attackers: ref('triggering.player'),
          defenders: objects({
            zone: 'battlefield',
            type: 'Planeswalker',
            subtypes: ['Jace'],
            controller: 'you',
          }),
        })],
      })],
    }),
    activated({
      timing: 'sorcery',
      costs: [plusLoyalty(1)],
      instructions: [
        draw(2),
        chooseCards({
          chooser: ref('controller'),
          bindChoice: 'bottom',
          filter: objects({ zone: 'hand', owner: 'you' }),
          count: 1,
        }),
        move({ targets: choice('bottom'), to: 'library', position: 'bottom' }),
      ],
    }),
    activated({
      timing: 'sorcery',
      costs: [minusLoyalty(3)],
      decisions: { targets: [select({
        filter: objects({
          zone: 'battlefield',
          controller: 'you',
          other: true,
          any: [{ type: 'Creature' }, { type: 'Planeswalker' }],
        }),
        count: 1,
      })] },
      instructions: [
        move({ targets: target(0), to: 'exile' }),
        revealUntil({
          targets: ref('controller'),
          match: objects({ zone: 'library', any: [{ type: 'Creature' }, { type: 'Planeswalker' }] }),
          foundTo: 'battlefield',
          rest: REVEAL_UNTIL_REST.keep,
          bindRest: 'rest',
        }),
        move({ targets: choice('rest'), to: 'library', position: 'bottom', order: 'random' }),
      ],
    }),
  ]),
} satisfies CatalogEntry
