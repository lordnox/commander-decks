import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import type { GameEvent, GameState, Plugin, PlayerId, ReduceResult } from '../types'

type DeckCard = {
  name: string
  card: {
    cmc: number
    mana_cost: string
    oracle_text: string
    power?: string | null
    toughness?: string | null
    type_line: string
  }
}

const deckCardsPath = join(
  import.meta.dir,
  '../../../decks/3-_cirdan-show-me-what-you-got/cards.json',
)

const deckCards = (JSON.parse(readFileSync(deckCardsPath, 'utf8')) as { cards: DeckCard[] }).cards

const SUPERTYPES = ['Legendary', 'Basic', 'Snow', 'World']

/** Exact Oracle text and typeline from the stored Círdan deck, so tests exercise the printed card. */
export const deckCard = (name: string, extra: Partial<CardTemplate> = {}): CardTemplate => {
  const entry = deckCards.find((card) => card.name === name)
  if (!entry) throw new Error(`${name} is not in the Círdan deck`)
  const { card } = entry
  const [front, back = ''] = card.type_line.split(' — ')
  const words = front.split(' ')
  const colors = [...new Set([...card.mana_cost.matchAll(/[WUBRG]/g)].map((match) => match[0]))]
  const hasStats = card.power !== undefined && card.power !== null
  return cardTemplate(name, {
    types: words.filter((word) => !SUPERTYPES.includes(word)),
    supertypes: words.filter((word) => SUPERTYPES.includes(word)),
    subtypes: back ? back.split(' ') : [],
    manaCost: card.mana_cost,
    manaValue: card.cmc,
    colors,
    oracleText: card.oracle_text,
    ...(hasStats ? { power: Number(card.power), toughness: Number(card.toughness) } : {}),
    ...extra,
  })
}

export const deckOracle = (name: string) => deckCard(name).oracleText

/** A plain creature fixture with a given mana value, for rules that read it. */
export const fixtureCreature = (
  name: string,
  extra: Partial<CardTemplate> = {},
) => cardTemplate(name, { types: ['Creature'], power: 2, toughness: 2, ...extra })

export const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

export const allNamed = (state: GameState, name: string) =>
  Object.values(state.objects).filter((object) => object.name === name)

export const artifact = (name: string, extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types: ['Artifact'], ...extra })

/** A library of anonymous instants, long enough that draws never deck a player. */
export const libraryOf = (seat: string, count = 6) =>
  Array.from({ length: count }, (_, index) =>
    cardTemplate(`${seat} card ${index}`, { types: ['Instant'] }))

export const libraries = (seats: string[], count = 6) =>
  Object.fromEntries(seats.map((seat) => [seat, libraryOf(seat, count)]))

/** Moves a card onto the battlefield the way any entry does, so enter triggers fire. */
export const enter = (
  server: { rules: (state: GameState, event: GameEvent) => ReduceResult },
  state: GameState,
  name: string,
) => ok(server.rules(state, { type: 'move', objectId: named(state, name).id, to: 'battlefield' }))

/** The controller's answer to an open "choose" selection, by card name. */
export const choose = (
  state: GameState,
  names: string[],
  count = 1,
  seat: PlayerId = 'p1',
): GameEvent => ({
  type: 'selectCards',
  seat,
  kind: 'choose',
  count,
  objectIds: names.map((name) => named(state, name).id),
})

/** p1 attacks p2 with every creature ready; helpers drive attack, block, and step changes. */
export const combatGame = (
  p1: CardTemplate[],
  p2: CardTemplate[] = [],
  options: { players?: 2 | 3 | 4; plugins?: Plugin[] } = {},
) => {
  const server = createServerGame(
    commanderRules,
    { players: options.players ?? 2, battlefield: { p1, p2 } },
    { random: () => 0.5, cardPlugins: options.plugins ?? [] },
  )
  const ready = structuredClone(server.state)
  for (const object of Object.values(ready.objects)) object.summoningSickness = false
  ready.step = 'declareAttackers'
  const send = (state: GameState, event: GameEvent) => ok(server.rules(state, event))
  const attackWith = (state: GameState, ...names: string[]) =>
    send(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: names.map((name) => ({ objectId: named(state, name).id, defender: 'p2' })),
    })
  const blockResult = (state: GameState, ...pairs: Array<[string, string]>) =>
    server.rules(state, {
      type: 'declareBlockers',
      seat: 'p2',
      blockers: pairs.map(([blocker, attacker]) => ({
        blockerId: named(state, blocker).id,
        attackerId: named(state, attacker).id,
      })),
    })
  const blockWith = (state: GameState, ...pairs: Array<[string, string]>) =>
    ok(blockResult(state, ...pairs))
  const blockError = (state: GameState, ...pairs: Array<[string, string]>) => {
    const result = blockResult(state, ...pairs)
    return result.ok ? undefined : result.error
  }
  const advance = (state: GameState) => send(state, { type: 'advanceStep' })
  /** Declare attackers, then move to the declare-blockers step. */
  const toBlockers = (...attackers: string[]) => advance(attackWith(ready, ...attackers))
  return { server, ready, send, attackWith, blockWith, blockError, advance, toBlockers }
}
