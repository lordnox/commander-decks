import type { CatalogEntry, ScryfallCardData } from './types'
import { snapshotFor, colorSetFromScryfall } from './snapshot'
import { enters, gainLife, objects, players, playLands, ref, revealLibraryTop, staticAbility, whenever } from '../cardPlugins/dsl/v1'

// Retrieved from Scryfall on 2026-10-23.
// Rules fields verified against Scryfall on 2026-10-23.
const scryfall = {
  "object": "card",
  "id": "dc63d2ea-a980-466e-9ebb-f28008f84c3d",
  "oracle_id": "46779609-4fa7-4fd2-b5b4-7d4d749339e6",
  "multiverse_ids": [
    625293
  ],
  "mtgo_id": 114117,
  "tcgplayer_id": 505990,
  "cardmarket_id": 723085,
  "name": "Courser of Kruphix",
  "lang": "en",
  "released_at": "2023-08-04",
  "uri": "https://api.scryfall.com/cards/dc63d2ea-a980-466e-9ebb-f28008f84c3d",
  "scryfall_uri": "https://scryfall.com/card/cmm/888/courser-of-kruphix?utm_source=api",
  "layout": "normal",
  "highres_image": true,
  "image_status": "highres_scan",
  "image_updated_at": "2026-07-13T04:03:46Z",
  "image_uris": {
    "small": "https://cards.scryfall.io/small/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.jpg?1783915426",
    "normal": "https://cards.scryfall.io/normal/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.jpg?1783915426",
    "large": "https://cards.scryfall.io/large/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.jpg?1783915426",
    "png": "https://cards.scryfall.io/png/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.png?1783915426",
    "art_crop": "https://cards.scryfall.io/art_crop/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.jpg?1783915426",
    "border_crop": "https://cards.scryfall.io/border_crop/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.jpg?1783915426",
    "thumb": "https://cards.scryfall.io/thumb/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.webp?1783915426",
    "grid": "https://cards.scryfall.io/grid/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.webp?1783915426",
    "display": "https://cards.scryfall.io/display/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.webp?1783915426",
    "art": "https://cards.scryfall.io/art/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.webp?1783915426",
    "crop": "https://cards.scryfall.io/crop/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.webp?1783915426",
    "jpeg": "https://cards.scryfall.io/normal/front/d/c/dc63d2ea-a980-466e-9ebb-f28008f84c3d.jpg?1783915426"
  },
  "mana_cost": "{1}{G}{G}",
  "cmc": 3.0,
  "type_line": "Enchantment Creature — Centaur",
  "oracle_text": "Play with the top card of your library revealed.\nYou may play lands from the top of your library.\nLandfall — Whenever a land you control enters, you gain 1 life.",
  "power": "2",
  "toughness": "4",
  "colors": [
    "G"
  ],
  "color_identity": [
    "G"
  ],
  "keywords": [
    "Landfall"
  ],
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
  "rulings_uri": "https://api.scryfall.com/cards/dc63d2ea-a980-466e-9ebb-f28008f84c3d/rulings",
  "prints_search_uri": "https://api.scryfall.com/cards/search?order=released&q=oracleid%3A46779609-4fa7-4fd2-b5b4-7d4d749339e6&unique=prints",
  "collector_number": "888",
  "digital": false,
  "rarity": "rare",
  "card_back_id": "0aeebaf5-8c7d-4636-9e82-8c27447861f7",
  "artist": "Eric Deschamps",
  "artist_ids": [
    "37970e22-9cee-44c1-af44-5ee27cf26b76"
  ],
  "illustration_id": "9c9cbfac-2ba7-4570-acf2-d0d1dd6b560d",
  "border_color": "black",
  "frame": "2015",
  "frame_effects": [
    "enchantment"
  ],
  "security_stamp": "oval",
  "full_art": false,
  "textless": false,
  "booster": false,
  "story_spotlight": false,
  "edhrec_rank": 1353,
  "penny_rank": 707,
  "prices": {
    "usd": "2.26",
    "usd_foil": null,
    "usd_etched": null,
    "eur": "1.15",
    "eur_foil": null,
    "tix": "0.08"
  },
  "related_uris": {
    "gatherer": "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=625293&printed=false",
    "tcgplayer_infinite_articles": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Farticles&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Farticles%3FproductLineName%3Dmagic%26q%3DCourser%2Bof%2BKruphix",
    "tcgplayer_infinite_decks": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Fdecks&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fdecks%3FproductLineName%3Dmagic%26q%3DCourser%2Bof%2BKruphix",
    "edhrec": "https://edhrec.com/route/?cc=Courser+of+Kruphix"
  },
  "purchase_uris": {
    "tcgplayer": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F505990%3Fpage%3D1",
    "cardmarket": "https://www.cardmarket.com/en/Magic/Products?idProduct=723085&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall",
    "cardhoarder": "https://www.cardhoarder.com/cards/114117?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall"
  }
} satisfies ScryfallCardData

export default {
  scryfall,
  types: ['Creature'],
  subtypes: scryfall.type_line.split(' — ')[1]?.split(' ') ?? [],
  colors: colorSetFromScryfall(scryfall.colors), manaCost: scryfall.mana_cost, manaValue: scryfall.cmc,
  ruleDefinition: snapshotFor([
    staticAbility(revealLibraryTop(players({ relation: 'you' }))),
    staticAbility(playLands(players({ relation: 'you' }), objects({ zone: 'library', owner: 'you', type: 'Land' }), { topOnly: true })),
    whenever(enters({ filter: { type: 'Land', controller: 'you' } }), { instructions: [gainLife({ targets: ref('controller'), amount: 1 })] }),
  ]),
} satisfies CatalogEntry
