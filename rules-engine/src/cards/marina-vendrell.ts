import type { CatalogEntry, ScryfallCardData } from './types'
import { snapshotFor, colorSetFromScryfall } from './snapshot'
import {
  LIBRARY_VISIBILITY,
  activated,
  choice,
  inspectTop,
  lockOrUnlockDoor,
  move,
  objects,
  ref,
  select,
  self,
  tapCost,
  target,
  whenever,
} from '../cardPlugins/dsl/v1'

// Copied from the shared Scryfall cache; source retrieval date is 2026-10-22.
// Rules fields verified against Scryfall on 2026-10-22.
const scryfall = {
  "arena_id": 92315,
  "artist": "Magali Villeneuve",
  "artist_ids": [
    "9e6a55ae-be4d-4c23-a2a5-135737ffd879"
  ],
  "booster": true,
  "border_color": "black",
  "card_back_id": "0aeebaf5-8c7d-4636-9e82-8c27447861f7",
  "cardmarket_id": 788270,
  "cmc": 5.0,
  "collector_number": "221",
  "color_identity": [
    "B",
    "G",
    "R",
    "U",
    "W"
  ],
  "colors": [
    "B",
    "G",
    "R",
    "U",
    "W"
  ],
  "digital": false,
  "edhrec_rank": 8505,
  "finishes": [
    "nonfoil",
    "foil"
  ],
  "foil": true,
  "frame": "2015",
  "frame_effects": [
    "legendary"
  ],
  "full_art": false,
  "game_changer": false,
  "games": [
    "paper",
    "mtgo",
    "arena"
  ],
  "highres_image": true,
  "id": "6428cddc-2fb6-41af-a643-e83c81dc04f5",
  "illustration_id": "27f3e8c5-4572-461a-8646-e900c870fbd8",
  "image_status": "highres_scan",
  "image_updated_at": "2026-07-13T02:24:02Z",
  "image_uris": {
    "art": "https://cards.scryfall.io/art/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.webp?1783909442",
    "art_crop": "https://cards.scryfall.io/art_crop/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.jpg?1783909442",
    "border_crop": "https://cards.scryfall.io/border_crop/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.jpg?1783909442",
    "crop": "https://cards.scryfall.io/crop/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.webp?1783909442",
    "display": "https://cards.scryfall.io/display/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.webp?1783909442",
    "grid": "https://cards.scryfall.io/grid/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.webp?1783909442",
    "jpeg": "https://cards.scryfall.io/normal/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.jpg?1783909442",
    "large": "https://cards.scryfall.io/large/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.jpg?1783909442",
    "normal": "https://cards.scryfall.io/normal/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.jpg?1783909442",
    "png": "https://cards.scryfall.io/png/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.png?1783909442",
    "small": "https://cards.scryfall.io/small/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.jpg?1783909442",
    "thumb": "https://cards.scryfall.io/thumb/front/6/4/6428cddc-2fb6-41af-a643-e83c81dc04f5.webp?1783909442"
  },
  "keywords": [],
  "lang": "en",
  "layout": "normal",
  "legalities": {
    "alchemy": "legal",
    "brawl": "legal",
    "commander": "legal",
    "competitivebrawl": "legal",
    "duel": "legal",
    "future": "legal",
    "gladiator": "legal",
    "historic": "legal",
    "legacy": "legal",
    "modern": "legal",
    "oathbreaker": "legal",
    "oldschool": "not_legal",
    "pauper": "not_legal",
    "paupercommander": "not_legal",
    "penny": "legal",
    "pioneer": "legal",
    "predh": "not_legal",
    "premodern": "not_legal",
    "standard": "legal",
    "standardbrawl": "legal",
    "timeless": "legal",
    "tlr": "not_legal",
    "vintage": "legal"
  },
  "mana_cost": "{W}{U}{B}{R}{G}",
  "mtgo_id": 130573,
  "multiverse_ids": [
    673626
  ],
  "name": "Marina Vendrell",
  "nonfoil": true,
  "object": "card",
  "oracle_id": "5aafc6c3-14f2-45b1-bd5b-c27760d791dd",
  "oracle_text": "When Marina Vendrell enters, reveal the top seven cards of your library. Put all enchantment cards from among them into your hand and the rest on the bottom of your library in a random order.\n{T}: Lock or unlock a door of target Room you control. Activate only as a sorcery.",
  "oversized": false,
  "penny_rank": 12883,
  "power": "3",
  "preview": {
    "previewed_at": "2024-09-11",
    "source": "Wizards of the Coast",
    "source_uri": "https://x.com/mtgjp/status/1833802823345295743"
  },
  "prices": {
    "eur": "0.17",
    "eur_foil": "0.28",
    "tix": "0.02",
    "usd": "0.20",
    "usd_etched": null,
    "usd_foil": "0.38"
  },
  "prints_search_uri": "https://api.scryfall.com/cards/search?order=released&q=oracleid%3A5aafc6c3-14f2-45b1-bd5b-c27760d791dd&unique=prints",
  "promo": false,
  "purchase_uris": {
    "cardhoarder": "https://www.cardhoarder.com/cards/130573?affiliate_id=scryfall&ref=card-profile&utm_campaign=affiliate&utm_medium=card&utm_source=scryfall",
    "cardmarket": "https://www.cardmarket.com/en/Magic/Products?idProduct=788270&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall",
    "tcgplayer": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F578897%3Fpage%3D1"
  },
  "rarity": "rare",
  "related_uris": {
    "edhrec": "https://edhrec.com/route/?cc=Marina+Vendrell",
    "gatherer": "https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid=673626&printed=false",
    "tcgplayer_infinite_articles": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Farticles&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Farticles%3FproductLineName%3Dmagic%26q%3DMarina%2BVendrell",
    "tcgplayer_infinite_decks": "https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&trafcat=tcgplayer.com%2Fsearch%2Fdecks&u=https%3A%2F%2Fwww.tcgplayer.com%2Fsearch%2Fdecks%3FproductLineName%3Dmagic%26q%3DMarina%2BVendrell"
  },
  "released_at": "2024-09-27",
  "reprint": false,
  "reserved": false,
  "rulings_uri": "https://api.scryfall.com/cards/6428cddc-2fb6-41af-a643-e83c81dc04f5/rulings",
  "scryfall_set_uri": "https://scryfall.com/sets/dsk?utm_source=api",
  "scryfall_uri": "https://scryfall.com/card/dsk/221/marina-vendrell?utm_source=api",
  "security_stamp": "oval",
  "set": "dsk",
  "set_id": "a111d8a9-b647-48ec-afab-2b78f92173f5",
  "set_name": "Duskmourn: House of Horror",
  "set_search_uri": "https://api.scryfall.com/cards/search?order=set&q=e%3Adsk&unique=prints",
  "set_type": "expansion",
  "set_uri": "https://api.scryfall.com/sets/a111d8a9-b647-48ec-afab-2b78f92173f5",
  "story_spotlight": false,
  "tcgplayer_id": 578897,
  "textless": false,
  "toughness": "5",
  "type_line": "Legendary Creature \u2014 Human Warlock",
  "uri": "https://api.scryfall.com/cards/6428cddc-2fb6-41af-a643-e83c81dc04f5",
  "variation": false
} satisfies ScryfallCardData

const typeWords = scryfall.type_line.split(' — ')[0].split(' ')

export default {
  scryfall,
  types: typeWords.filter(type => type !== 'Legendary'),
  supertypes: typeWords.filter(type => type === 'Legendary'),
  subtypes: scryfall.type_line.split(' — ')[1]?.split(' ') ?? [],
  colors: colorSetFromScryfall(scryfall.colors),
  manaCost: scryfall.mana_cost,
  manaValue: scryfall.cmc,
  ruleDefinition: snapshotFor([
    whenever(self.enters, {
      instructions: [
        inspectTop({ player: ref('controller'), count: 7, bindChoice: 'top', visibility: LIBRARY_VISIBILITY.public }),
        move({ targets: objects({ among: choice('top'), type: 'Enchantment' }), to: 'hand' }),
        move({
          targets: objects({ among: choice('top'), not: { type: 'Enchantment' } }),
          to: 'library',
          position: 'bottom',
          order: 'random',
        }),
      ],
    }),
    activated({
      timing: 'sorcery',
      costs: [tapCost()],
      decisions: {
        targets: [select({
          filter: objects({ zone: 'battlefield', subtypes: ['Room'], controller: 'you' }),
          count: 1,
        })],
      },
      instructions: [lockOrUnlockDoor({ targets: target(0) })],
    }),
  ]),
} satisfies CatalogEntry
