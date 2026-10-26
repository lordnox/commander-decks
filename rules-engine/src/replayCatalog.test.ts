import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cardFaces, catalogEntry as dealCatalogEntry } from '../../.agents/skills/simulate-table/scripts/deal-table'
import { catalogEntry, deckCards, DECK_DIRECTORIES } from './deckCardFixtures'
import { replayCardTemplate } from './replay'

describe('external catalog color transport', () => {
  test('table catalogs preserve explicit empty colors and omit absent characteristics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'replay-colors-'))
    try {
      await writeFile(join(directory, 'card.json'), JSON.stringify({
        colors: [], color_indicator: ['R'], mana_cost: '{B}',
      }))
      const entry = await dealCatalogEntry({ cache: 'card.json' }, directory)
      expect(entry.colors).toEqual([])
      expect(entry.color_indicator).toEqual(['R'])
      expect(replayCardTemplate('Fixture', entry).colors).toBe('')
      const absent = await dealCatalogEntry({}, directory)
      expect(absent).not.toHaveProperty('colors')
      expect(absent).not.toHaveProperty('color_indicator')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('table face catalogs retain empty colors and indicator-only characteristics', () => {
    const faces = cardFaces({ card_faces: [
      { colors: [], image_uris: { small: 'front' } },
      { color_indicator: ['R'], image_uris: { small: 'back' } },
    ] })!
    expect(faces[0].colors).toEqual([])
    expect(faces[0]).not.toHaveProperty('color_indicator')
    expect(faces[1].color_indicator).toEqual(['R'])
    expect(faces[1]).not.toHaveProperty('colors')
  })

  test('deck fixtures retain color characteristics from the authoritative cache', async () => {
    for (const directory of DECK_DIRECTORIES) {
      for (const entry of deckCards(directory)) {
        if (!entry.cache) continue
        const source = await Bun.file(join(import.meta.dir, '../..', entry.cache)).json()
        const catalog = catalogEntry(entry)
        expect(catalog.colors).toEqual(source.colors)
        expect(catalog.color_indicator).toEqual(source.color_indicator)
        for (const [index, face] of (catalog.faces ?? []).entries()) {
          expect(face.colors).toEqual(source.card_faces?.[index]?.colors)
          expect(face.color_indicator).toEqual(source.card_faces?.[index]?.color_indicator)
        }
      }
    }
  })
})
