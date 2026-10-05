import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handlerIdsForNames } from './cardPlugins/cardRules'
import type { CardTemplate } from './newGame'
import { replayCardTemplate, type ReplayCard } from './replay'
import type { Plugin } from './types'

/** Decks whose `cards.json` Oracle text card tests treat as authoritative. */
export const DECK_DIRECTORIES = [
  '3-_homer-dumpster-diver-crab',
  '2+_lady-evangela-foggy-blood-transfusion',
  '3_sin-fall',
  '3-_cirdan-show-me-what-you-got',
] as const

type DeckFace = {
  mana_cost?: string
  name?: string
  oracle_text?: string
  type_line?: string
}

type DeckCard = {
  name: string
  card: DeckFace & {
    faces?: DeckFace[]
    power?: string
    toughness?: string
  }
}

const decksRoot = join(import.meta.dir, '../../decks')

const loadDeck = (directory: string) =>
  (JSON.parse(readFileSync(join(decksRoot, directory, 'cards.json'), 'utf8')) as {
    cards: DeckCard[]
  }).cards

/** Every distinct card of a deck's `cards.json`, in file order. */
export const deckCards = (directory: string) => {
  const seen = new Set<string>()
  return loadDeck(directory).filter((entry) => {
    if (seen.has(entry.name)) return false
    seen.add(entry.name)
    return true
  })
}

/** The catalog entry a table deal would build for this deck card. */
export const catalogEntry = ({ card }: DeckCard): ReplayCard => {
  const joined = (field: 'mana_cost' | 'oracle_text' | 'type_line') =>
    (card.faces ?? []).map((face) => face[field] ?? '').join(' // ')
  return {
    type_line: card.type_line ?? joined('type_line'),
    mana_cost: card.mana_cost ?? joined('mana_cost'),
    oracle_text: card.oracle_text ?? joined('oracle_text'),
    stats: card.power != null ? `${card.power}/${card.toughness}` : '',
    ...(card.faces && card.faces.length > 1
      ? {
          faces: card.faces.map((face) => ({
            name: face.name ?? '',
            type_line: face.type_line ?? '',
            mana_cost: face.mana_cost ?? '',
            oracle_text: face.oracle_text ?? '',
            stats: '',
          })),
        }
      : {}),
  }
}

/** A deck card as the live table builds it: production template path, authoritative Oracle text. */
export const deckCardTemplate = (
  name: string,
  overrides: Partial<CardTemplate> = {},
): CardTemplate => {
  for (const directory of DECK_DIRECTORIES) {
    const entry = deckCards(directory).find((candidate) => candidate.name === name)
    if (entry) return { ...replayCardTemplate(name, catalogEntry(entry)), ...overrides }
  }
  throw new Error(`no deck card named ${name}`)
}

/** The plugins a host loads for these cards: one module per handler id, as `loadHostCardPlugins` does. */
export const loadCardPlugins = (names: string[]) => Promise.all(
  handlerIdsForNames(names).map(async (handlerId) => {
    const module = await import(`./cardPlugins/${handlerId}`) as Record<string, unknown>
    const plugin = Object.values(module).find(
      (value): value is Plugin =>
        typeof value === 'object' && value !== null && 'id' in value && value.id === handlerId,
    )
    if (!plugin) throw new Error(`card plugin ${handlerId} does not export id ${handlerId}`)
    return plugin
  }),
)
