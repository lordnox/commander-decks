import type { CatalogEntry, ScryfallCardData } from './types'
import { snapshotFor, colorSetFromScryfall } from './snapshot'
import { compareAmount, count, objects, players, ref, replacement, replaceWith, staticAbility, winGame, wouldDraw } from '../cardPlugins/dsl/v1'

// Retrieved from Scryfall on 2026-10-25; no cached entry was available.
const scryfall = {
  "object": "card",
  "id": "7a5be94c-08b8-4964-a79d-e22ea6e94be8",
  "oracle_id": "aa286dd5-aa19-446d-9003-684d81eb57ca",
  "multiverse_ids": [
    685897
  ],
  "mtgo_id": 135522,
  "tcgplayer_id": 609835,
  "cardmarket_id": 805727,
  "name": "Laboratory Maniac",
  "lang": "en",
  "released_at": "2025-01-24",
  "uri": "https://api.scryfall.com/cards/7a5be94c-08b8-4964-a79d-e22ea6e94be8",
  "scryfall_uri": "https://scryfall.com/card/inr/71/laboratory-maniac?utm_source=api",
  "layout": "normal",
  "highres_image": true,
  "image_status": "highres_scan",
  "image_updated_at": "2026-07-13T02:02:42Z",
  "image_uris": {
    "small": "https://cards.scryfall.io/small/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.jpg?1783908162",
    "normal": "https://cards.scryfall.io/normal/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.jpg?1783908162",
    "large": "https://cards.scryfall.io/large/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.jpg?1783908162",
    "png": "https://cards.scryfall.io/png/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.png?1783908162",
    "art_crop": "https://cards.scryfall.io/art_crop/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.jpg?1783908162",
    "border_crop": "https://cards.scryfall.io/border_crop/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.jpg?1783908162",
    "thumb": "https://cards.scryfall.io/thumb/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.webp?1783908162",
    "grid": "https://cards.scryfall.io/grid/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.webp?1783908162",
    "display": "https://cards.scryfall.io/display/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.webp?1783908162",
    "art": "https://cards.scryfall.io/art/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.webp?1783908162",
    "crop": "https://cards.scryfall.io/crop/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.webp?1783908162",
    "jpeg": "https://cards.scryfall.io/normal/front/7/a/7a5be94c-08b8-4964-a79d-e22ea6e94be8.jpg?1783908162"
  },
  "mana_cost": "{2}{U}",
  "cmc": 3.0,
  "type_line": "Creature — Human Wizard",
  "oracle_text": "If you would draw a card while your library has no cards in it, you win the game instead.",
  "power": "2",
  "toughness": "2",
  "colors": [
    "U"
  ],
  "color_identity": [
    "U"
  ],
  "keywords": [],
  "legalities": {
    "standard": "not_legal",
    "future": "not_legal",
    "historic": "legal",
    "timeless": "legal",
    "gladiator": "legal",
    "pioneer": "not_legal",
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
    "mtgo"
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
  "reprint": true,
  "variation": false,
  "set_id": "b9618c8c-9f31-4b42-9798-2991893c27bf",
  "set": "inr",
  "set_name": "Innistrad Remastered",
  "set_type": "masters",
  "set_uri": "https://api.scryfall.com/sets/b9618c8c-9f31-4b42-9798-2991893c27bf",
  "set_search_uri": "https://api.scryfall.com/cards/search?order=set&q=e%3Ainr&unique=prints",
  "scryfall_set_uri": "https://scryfall.com/sets/inr?utm_source=api",
  "rulings_uri": "https://api.scryfall.com/cards/7a5be94c-08b8-4964-a79d-e22ea6e94be8/rulings",
  "prints_search_uri": "https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aaa286dd5-aa19-446d-9003-684d81eb57ca&unique=prints",
  "collector_number": "71",
  "digital": false,
  "rarity": "uncommon",
  "flavor_text": "His mind whirled with grand plans, never thinking of what might happen if he were to succeed.",
  "card_back_id": "0aeebaf5-8c7d-4636-9e82-8c27447861f7",
  "artist": "Jason Felix",
  "artist_ids": [
    "af42a44c-8ec3-47a7-9047-5d29ddad186d"
  ],
  "illustration_id": "39c07176-ff38-45bb-8865-32797f8d9807",
  "border_color": "black",
  "frame": "2015",
  "full_art": false,
  "textless": false,
  "booster": true,
  "story_spotlight": false,
  "edhrec_rank": 551,
  "penny_rank": 824,
  "prices": {
    "usd": "1.81",
    "usd_foil": "2.28",
    "usd_etched": null,
    "eur": "0.87",
    "eur_foil": "0.85",
    "tix": "0.04"
  },
  "related_uris": {
    "gatherer": "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=685897&printed=false",
    "tcgplayer_infinite_articles": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Farticles&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Farticles%3FproductLineName%3Dmagic%26q%3DLaboratory%2BManiac",
    "tcgplayer_infinite_decks": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Fdecks&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fdecks%3FproductLineName%3Dmagic%26q%3DLaboratory%2BManiac",
    "edhrec": "https://edhrec.com/route/?cc=Laboratory+Maniac"
  },
  "purchase_uris": {
    "tcgplayer": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F609835%3Fpage%3D1",
    "cardmarket": "https://www.cardmarket.com/en/Magic/Products?idProduct=805727&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall",
    "cardhoarder": "https://www.cardhoarder.com/cards/135522?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall"
  }
} satisfies ScryfallCardData

export default {
  scryfall,
  types: ['Creature'],
  subtypes: ['Human', 'Wizard'],
  colors: colorSetFromScryfall(scryfall.colors),
  manaCost: scryfall.mana_cost,
  manaValue: scryfall.cmc,
  power: Number(scryfall.power),
  toughness: Number(scryfall.toughness),
  ruleDefinition: snapshotFor([
    staticAbility(replacement(
      wouldDraw({ player: players({ relation: 'you' }) }),
      replaceWith(winGame({ targets: ref('controller') })),
      { when: compareAmount(count(objects({ zone: 'library', owner: 'you' })), 'eq', 0) },
    )),
  ]),
} satisfies CatalogEntry
