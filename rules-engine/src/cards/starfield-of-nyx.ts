import type { CatalogEntry, ScryfallCardData } from './types'
import { snapshotFor } from './snapshot'
import { addTypesTo, characteristic, compareAmount, count, may, modifyStats, move, objects, players, ref, select, staticAbility, stepBegins, target, whenever } from '../cardPlugins/dsl/v1'

// Copied from the shared Scryfall cache when available; original retrieval date is unknown.
// Rules fields verified against Scryfall on 2026-10-23.
const scryfall = {
  "object": "card",
  "id": "bfe4e1cb-ceee-46aa-96d1-f3f26516cd77",
  "oracle_id": "922d603e-6623-4455-b91f-fad76f94045a",
  "multiverse_ids": [
    625245
  ],
  "mtgo_id": 114021,
  "tcgplayer_id": 505972,
  "cardmarket_id": 723063,
  "name": "Starfield of Nyx",
  "lang": "en",
  "released_at": "2023-08-04",
  "uri": "https://api.scryfall.com/cards/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77",
  "scryfall_uri": "https://scryfall.com/card/cmm/840/starfield-of-nyx?utm_source=api",
  "layout": "normal",
  "highres_image": true,
  "image_status": "highres_scan",
  "image_updated_at": "2026-07-13T04:04:05Z",
  "image_uris": {
    "small": "https://cards.scryfall.io/small/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.jpg?1783915445",
    "normal": "https://cards.scryfall.io/normal/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.jpg?1783915445",
    "large": "https://cards.scryfall.io/large/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.jpg?1783915445",
    "png": "https://cards.scryfall.io/png/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.png?1783915445",
    "art_crop": "https://cards.scryfall.io/art_crop/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.jpg?1783915445",
    "border_crop": "https://cards.scryfall.io/border_crop/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.jpg?1783915445",
    "thumb": "https://cards.scryfall.io/thumb/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.webp?1783915445",
    "grid": "https://cards.scryfall.io/grid/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.webp?1783915445",
    "display": "https://cards.scryfall.io/display/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.webp?1783915445",
    "art": "https://cards.scryfall.io/art/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.webp?1783915445",
    "crop": "https://cards.scryfall.io/crop/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.webp?1783915445",
    "jpeg": "https://cards.scryfall.io/normal/front/b/f/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77.jpg?1783915445"
  },
  "mana_cost": "{4}{W}",
  "cmc": 5.0,
  "type_line": "Enchantment",
  "oracle_text": "At the beginning of your upkeep, you may return target enchantment card from your graveyard to the battlefield.\nAs long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.",
  "colors": [
    "W"
  ],
  "color_identity": [
    "W"
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
    "tlr": "not_legal"
  },
  "games": [
    "paper",
    "mtgo"
  ],
  "reserved": false,
  "game_changer": false,
  "foil": false,
  "nonfoil": true,
  "finishes": [
    "nonfoil"
  ],
  "oversized": false,
  "promo": false,
  "reprint": true,
  "variation": false,
  "set_id": "cd05036f-2698-43e6-a48e-5c8d82f0a551",
  "set": "cmm",
  "set_name": "Commander Masters",
  "set_type": "masters",
  "set_uri": "https://api.scryfall.com/sets/cd05036f-2698-43e6-a48e-5c8d82f0a551",
  "set_search_uri": "https://api.scryfall.com/cards/search?order=set&q=e%3Acmm&unique=prints",
  "scryfall_set_uri": "https://scryfall.com/sets/cmm?utm_source=api",
  "rulings_uri": "https://api.scryfall.com/cards/bfe4e1cb-ceee-46aa-96d1-f3f26516cd77/rulings",
  "prints_search_uri": "https://api.scryfall.com/cards/search?order=released&q=oracleid%3A922d603e-6623-4455-b91f-fad76f94045a&unique=prints",
  "collector_number": "840",
  "digital": false,
  "rarity": "mythic",
  "card_back_id": "0aeebaf5-8c7d-4636-9e82-8c27447861f7",
  "artist": "Tyler Jacobson",
  "artist_ids": [
    "522af130-8db4-4b4b-950c-6e2b246339cf"
  ],
  "illustration_id": "dfe09ac8-3922-4f2c-9628-495da288e2de",
  "border_color": "black",
  "frame": "2015",
  "security_stamp": "oval",
  "full_art": false,
  "textless": false,
  "booster": false,
  "story_spotlight": false,
  "edhrec_rank": 2341,
  "penny_rank": 4031,
  "prices": {
    "usd": "12.84",
    "usd_foil": null,
    "usd_etched": null,
    "eur": "12.75",
    "eur_foil": null,
    "tix": "0.19"
  },
  "related_uris": {
    "gatherer": "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=625245&printed=false",
    "tcgplayer_infinite_articles": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Farticles&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Farticles%3FproductLineName%3Dmagic%26q%3DStarfield%2Bof%2BNyx",
    "tcgplayer_infinite_decks": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Fdecks&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fdecks%3FproductLineName%3Dmagic%26q%3DStarfield%2Bof%2BNyx",
    "edhrec": "https://edhrec.com/route/?cc=Starfield+of+Nyx"
  },
  "purchase_uris": {
    "tcgplayer": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F505972%3Fpage%3D1",
    "cardmarket": "https://www.cardmarket.com/en/Magic/Products?idProduct=723063&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall",
    "cardhoarder": "https://www.cardhoarder.com/cards/114021?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall"
  }
} satisfies ScryfallCardData

export default {
  scryfall,
  types: scryfall.type_line.split(' — ')[0].split(' '),
  subtypes: scryfall.type_line.split(' — ')[1]?.split(' ') ?? [],
  colors: scryfall.colors, manaCost: scryfall.mana_cost, manaValue: scryfall.cmc,
  ruleDefinition: snapshotFor([
whenever(stepBegins({ step: 'upkeep', player: players({ relation: 'you' }) }), {
  decisions: { targets: [select({ filter: objects({ zone: 'graveyard', type: 'Enchantment', owner: 'you' }), count: 1 })] },
  instructions: [may(move({ targets: target(0), to: 'battlefield' }))],
}),
staticAbility(
  addTypesTo({ targets: objects({ zone: 'battlefield', type: 'Enchantment', other: true, controller: 'you', not: { subtypes: ['Aura'] } }), types: ['Creature'], when: compareAmount(count(objects({ zone: 'battlefield', type: 'Enchantment', controller: 'you' })), 'gte', 5) }),
  modifyStats({ targets: objects({ zone: 'battlefield', type: 'Enchantment', other: true, controller: 'you', not: { subtypes: ['Aura'] } }), when: compareAmount(count(objects({ zone: 'battlefield', type: 'Enchantment', controller: 'you' })), 'gte', 5), set: true, power: characteristic(ref('subject'), 'manaValue', { information: 'current' }), toughness: characteristic(ref('subject'), 'manaValue', { information: 'current' }) }),
)
  ]),
} satisfies CatalogEntry
