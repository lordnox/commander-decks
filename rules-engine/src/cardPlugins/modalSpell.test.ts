import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, type CardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameEvent, GameState, ReduceResult } from '../types'
import { DIALOG_CHOSEN, pendingDialog, pendingDialogLock } from '../pendingDialog'
import { choiceEffects } from './choiceEffects'
import { modalSpell } from './modalSpell'
import { onResolve } from './onResolve'
import { librarySearch } from './librarySearch'

const card = (name: string, types: string[], extra: Partial<CardTemplate> = {}) =>
  cardTemplate(name, { types, power: null, toughness: null, ...extra })

const forest = () =>
  card('Forest', ['Land'], { subtypes: ['Forest'], supertypes: ['Basic'], tapProduces: { G: 1 } })

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const game = (options: {
  hand?: CardTemplate[]
  library?: CardTemplate[]
}) =>
  createServerGame(
    commanderRules,
    {
      hands: { p1: options.hand ?? [] },
      libraries: { p1: options.library ?? [] },
    },
    {
      random: () => 0.5,
      cardPlugins: [modalSpell, onResolve, choiceEffects, pendingDialogLock, librarySearch],
    },
  )

const run = (
  server: ReturnType<typeof game>,
  state: GameState,
  events: GameEvent[],
) => events.reduce((current, event) => ok(server.rules(current, event)), state)

describe('modalSpell', () => {
  test('Bushwhack opens a mode choice before its instructions run', () => {
    const server = game({
      hand: [card('Bushwhack', ['Sorcery'], { manaCost: '{G}' })],
      library: [forest(), card('Island', ['Land'], { subtypes: ['Island'], supertypes: ['Basic'] })],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const funded = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 } },
      },
    }
    const opened = run(server, funded, [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    expect(pendingDialog(opened)).toMatchObject({
      kind: 'choose-modes',
      source: 'Bushwhack',
    })
  })

  test('Decisive Denial opens the same modal flow as other choose-one spells', () => {
    const server = game({
      hand: [card('Decisive Denial', ['Instant'], { manaCost: '{G}{U}' })],
    })
    const spell = server.state.zoneOrder.p1.hand[0]
    const funded = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 1, B: 0, R: 0, G: 1, C: 0 } },
      },
    }
    const opened = run(server, funded, [
      { type: 'castSpell', seat: 'p1', objectId: spell },
      { type: 'resolveTop' },
    ])
    expect(pendingDialog(opened)).toMatchObject({
      kind: 'choose-modes',
      source: 'Decisive Denial',
    })
  })
})
