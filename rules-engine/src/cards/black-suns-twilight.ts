import type { CatalogEntry, ScryfallCardData } from './types'
import { snapshotFor } from './snapshot'
import {
  choice,
  chooseCards,
  chooseX,
  compareAmount,
  compareCharacteristic,
  createEffect,
  ifThen,
  manaCost,
  move,
  negate,
  objects,
  pumpEffect,
  ref,
  select,
  spell,
  target,
  untilCleanup,
  variable,
} from '../cardPlugins/dsl/v1'

// Scryfall response retrieved on 2026-10-21. Refresh explicitly when updating this card.
const scryfall = {
  "object": "card",
  "id": "e5bb4def-c67c-44c2-b3b2-8c53a077432d",
  "oracle_id": "af105cda-1f7c-4868-9407-a97c46bd762d",
  "multiverse_ids": [
    602614
  ],
  "mtgo_id": 106383,
  "arena_id": 83784,
  "tcgplayer_id": 478294,
  "cardmarket_id": 692398,
  "name": "Black Sun's Twilight",
  "lang": "en",
  "released_at": "2023-02-10",
  "uri": "https://api.scryfall.com/cards/e5bb4def-c67c-44c2-b3b2-8c53a077432d",
  "scryfall_uri": "https://scryfall.com/card/one/84/black-suns-twilight?utm_source=api",
  "layout": "normal",
  "highres_image": true,
  "image_status": "highres_scan",
  "image_updated_at": "2026-07-13T04:47:30Z",
  "image_uris": {
    "small": "https://cards.scryfall.io/small/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.jpg?1783918050",
    "normal": "https://cards.scryfall.io/normal/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.jpg?1783918050",
    "large": "https://cards.scryfall.io/large/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.jpg?1783918050",
    "png": "https://cards.scryfall.io/png/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.png?1783918050",
    "art_crop": "https://cards.scryfall.io/art_crop/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.jpg?1783918050",
    "border_crop": "https://cards.scryfall.io/border_crop/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.jpg?1783918050",
    "thumb": "https://cards.scryfall.io/thumb/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.webp?1783918050",
    "grid": "https://cards.scryfall.io/grid/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.webp?1783918050",
    "display": "https://cards.scryfall.io/display/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.webp?1783918050",
    "art": "https://cards.scryfall.io/art/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.webp?1783918050",
    "crop": "https://cards.scryfall.io/crop/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.webp?1783918050",
    "jpeg": "https://cards.scryfall.io/normal/front/e/5/e5bb4def-c67c-44c2-b3b2-8c53a077432d.jpg?1783918050"
  },
  "mana_cost": "{X}{B}",
  "cmc": 1.0,
  "type_line": "Instant",
  "oracle_text": "Up to one target creature gets -X/-X until end of turn. If X is 5 or more, return a creature card with mana value X or less from your graveyard to the battlefield tapped.",
  "colors": [
    "B"
  ],
  "color_identity": [
    "B"
  ],
  "keywords": [],
  "legalities": {
    "standard": "not_legal",
    "future": "not_legal",
    "historic": "legal",
    "timeless": "legal",
    "gladiator": "legal",
    "pioneer": "legal",
    "modern": "legal",
    "legacy": "legal",
    "pauper": "not_legal",
    "vintage": "legal",
    "penny": "legal",
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
    "tlr": "legal"
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
  "set_id": "04bef644-343f-4230-95ee-255f29aa67a2",
  "set": "one",
  "set_name": "Phyrexia: All Will Be One",
  "set_type": "expansion",
  "set_uri": "https://api.scryfall.com/sets/04bef644-343f-4230-95ee-255f29aa67a2",
  "set_search_uri": "https://api.scryfall.com/cards/search?order=set&q=e%3Aone&unique=prints",
  "scryfall_set_uri": "https://scryfall.com/sets/one?utm_source=api",
  "rulings_uri": "https://api.scryfall.com/cards/e5bb4def-c67c-44c2-b3b2-8c53a077432d/rulings",
  "prints_search_uri": "https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aaf105cda-1f7c-4868-9407-a97c46bd762d&unique=prints",
  "collector_number": "84",
  "digital": false,
  "rarity": "rare",
  "flavor_text": "\"Where once there was complacence, Sheoldred brought ambition, and soon the will of Yawgmoth reigned.\"\n—Monument inscription",
  "card_back_id": "0aeebaf5-8c7d-4636-9e82-8c27447861f7",
  "artist": "Jonas De Ro",
  "artist_ids": [
    "561ebf9e-8d93-4b57-8156-8826d0c19601"
  ],
  "illustration_id": "9cc3e231-db02-4de1-86e7-f542de621fed",
  "border_color": "black",
  "frame": "2015",
  "security_stamp": "oval",
  "full_art": false,
  "textless": false,
  "booster": true,
  "story_spotlight": false,
  "edhrec_rank": 5009,
  "penny_rank": 8681,
  "preview": {
    "source": "Wizards of the Coast",
    "source_uri": "",
    "previewed_at": "2023-01-12"
  },
  "prices": {
    "usd": "0.39",
    "usd_foil": "0.56",
    "usd_etched": null,
    "eur": "0.32",
    "eur_foil": "0.53",
    "tix": "0.02"
  },
  "related_uris": {
    "gatherer": "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=602614&printed=false",
    "tcgplayer_infinite_articles": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Farticles&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Farticles%3FproductLineName%3Dmagic%26q%3DBlack%2BSun%2527s%2BTwilight",
    "tcgplayer_infinite_decks": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Fdecks&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fdecks%3FproductLineName%3Dmagic%26q%3DBlack%2BSun%2527s%2BTwilight",
    "edhrec": "https://edhrec.com/route/?cc=Black+Sun%27s+Twilight"
  },
  "purchase_uris": {
    "tcgplayer": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F478294%3Fpage%3D1",
    "cardmarket": "https://www.cardmarket.com/en/Magic/Products?idProduct=692398&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall",
    "cardhoarder": "https://www.cardhoarder.com/cards/106383?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall"
  }
} satisfies ScryfallCardData

export default {
  scryfall,
  types: [scryfall.type_line],
  colors: scryfall.colors,
  manaCost: scryfall.mana_cost,
  manaValue: scryfall.cmc,
  ruleDefinition: snapshotFor([
    spell({
      costs: [manaCost(scryfall.mana_cost)],
      decisions: {
        variables: [chooseX()],
        targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature' }), min: 0, max: 1 })],
      },
      instructions: [
        createEffect({
          targets: target(0),
          effect: pumpEffect(negate(variable('X')), negate(variable('X'))),
          duration: untilCleanup(),
        }),
        ifThen(compareAmount(variable('X'), 'gte', 5), {
          then: [
            chooseCards({
              bindChoice: 'returned',
              chooser: ref('controller'),
              filter: objects({
                zone: 'graveyard',
                owner: 'you',
                type: 'Creature',
                compareCharacteristic: compareCharacteristic('manaValue', 'lte', variable('X')),
              }),
              count: 1,
            }),
            move({ targets: choice('returned'), to: 'battlefield', tapped: true }),
          ],
        }),
      ],
    }),
  ]),
} satisfies CatalogEntry
