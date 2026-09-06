import { describe, expect, test } from 'bun:test'
import type { LiveSnapshot } from './liveCodec'
import {
  batchScryfallIds,
  compactLiveSnapshot,
  hydrateLiveSnapshot,
  scryfallCardToDetails,
  type ScryfallCard,
} from './scryfallCache'

const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

const snapshotWith = (catalog: LiveSnapshot['catalog']): LiveSnapshot => ({
  v: 1,
  you: 'p1',
  headline: 'Test table',
  turn: 1,
  phase: 'main1',
  active: 'p1',
  stack: [],
  seats: [],
  catalog,
})

describe('Scryfall card conversion', () => {
  test('keeps two illustrated transform faces', () => {
    const card = {
      id: id(1),
      name: 'Front // Back',
      type_line: 'Creature — Human // Creature — Beast',
      card_faces: [
        {
          name: 'Front',
          image_uris: { small: 'front-small', normal: 'front-normal' },
          type_line: 'Creature — Human',
          mana_cost: '{1}{G}',
          oracle_text: 'Front text',
          power: '2',
          toughness: '2',
        },
        {
          name: 'Back',
          image_uris: { small: 'back-small', normal: 'back-normal' },
          type_line: 'Creature — Beast',
          oracle_text: 'Back text',
          power: '4',
          toughness: '4',
        },
      ],
    } satisfies ScryfallCard

    const details = scryfallCardToDetails(card)
    expect(details.image_small).toBe('front-small')
    expect(details.faces?.map((face) => face.image_small)).toEqual([
      'front-small',
      'back-small',
    ])
  })

  test('keeps parent art and joined text for adventure cards', () => {
    const card = {
      id: id(2),
      name: 'Creature // Adventure',
      image_uris: { small: 'parent-small', normal: 'parent-normal' },
      type_line: 'Creature — Human // Sorcery — Adventure',
      mana_cost: '',
      oracle_text: '',
      card_faces: [
        {
          name: 'Creature',
          mana_cost: '{2}{G}',
          oracle_text: 'Creature text',
        },
        {
          name: 'Adventure',
          mana_cost: '{G}',
          oracle_text: 'Adventure text',
        },
      ],
    } satisfies ScryfallCard

    const details = scryfallCardToDetails(card)
    expect(details.image_small).toBe('parent-small')
    expect(details.faces).toBeUndefined()
    expect(details.mana_cost).toBe('{2}{G} // {G}')
    expect(details.oracle_text).toBe('Creature text // Adventure text')
  })
})

describe('live card hydration', () => {
  test('batches at 75 ids', () => {
    expect(batchScryfallIds(Array.from({ length: 76 }, (_, index) => id(index)))).toHaveLength(2)
  })

  test('keeps successful batches when a later request fails', async () => {
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async (_input, init) => {
      calls += 1
      if (calls === 2) throw new Error('offline')
      const body = JSON.parse(String(init?.body)) as {
        identifiers: Array<{ id: string }>
      }
      return Response.json({
        data: body.identifiers.map(({ id: cardId }) => ({
          id: cardId,
          name: cardId,
          image_uris: { small: `${cardId}-small`, normal: `${cardId}-normal` },
          oracle_text: 'Hydrated',
        })),
        not_found: [],
      })
    }) as typeof fetch

    try {
      const catalog = Object.fromEntries(
        Array.from({ length: 76 }, (_, index) => [`Card ${index}`, { id: id(index) }]),
      )
      const result = await hydrateLiveSnapshot(snapshotWith(catalog))
      expect(calls).toBe(2)
      expect(result.complete).toBeFalse()
      expect(result.snapshot.catalog['Card 0'].oracle_text).toBe('Hydrated')
      expect(result.snapshot.catalog['Card 75']).toEqual({ id: id(75) })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('compacts hydrated details before making a public payload', () => {
    const snapshot = snapshotWith({
      Example: {
        id: id(1),
        image_small: 'small',
        oracle_text: 'Details must not return to the URL',
      },
      Custom: {
        oracle_text: 'Inline fallback',
      },
    })
    const compact = compactLiveSnapshot(snapshot)
    expect(compact.catalog.Example).toEqual({ id: id(1) })
    expect(compact.catalog.Custom.oracle_text).toBe('Inline fallback')
  })
})
