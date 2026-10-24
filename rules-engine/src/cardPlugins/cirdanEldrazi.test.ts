import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { createJournal, recordAccepted, restoreJournal } from '../journal'
import { cardTemplate } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import { pendingOptionSelection } from '../rules/selectOptions'
import { ok } from '../testHelpers'
import type { GameEvent, GameState } from '../types'
import { activated } from './activated'
import { deckCard, named } from './cirdanCreatureCards'
import { ability } from './effects'
import { ward } from './ward'

const answer = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  optionId: string,
) => server.rules(state, {
  type: 'selectOption',
  seat: 'p1',
  selectionId: pendingOptionSelection(state, 'p1')!.id,
  optionId,
})

const boltEvent = (state: GameState, target = 'Sire of Seven Deaths'): GameEvent => ({
  type: 'castSpell',
  seat: 'p1',
  objectId: named(state, 'Ward spell fixture').id,
  targets: [{ kind: 'object', objectId: named(state, target).id }],
})

const poker = () => cardTemplate('Fixture Poker', {
  types: ['Creature'],
  effects: [ability({ id: 'poker.poke', targets: 'creature' }, {}, { kind: 'gainLife', count: 1 })],
})

const bolt = () => cardTemplate('Ward spell fixture', { types: ['Instant'], manaCost: '{R}' })

describe('Sire of Seven Deaths', () => {
  describe('ward', () => {
    const wardGame = (life = 40) => {
      const server = createServerGame(commanderRules, {
        hands: { p1: [bolt()] },
        battlefield: {
          p1: [poker(), deckCard('Sire of Seven Deaths', { name: 'Own Sire' })],
          p2: [deckCard('Sire of Seven Deaths')],
        },
      }, { random: () => 0.5, cardPlugins: [ward, activated] })
      const ready = structuredClone(server.state)
      ready.players.p1.life = life
      ready.players.p1.mana.R = 1
      ready.priority = 'p1'
      return { server, ready }
    }

    test('targeting it asks only the caster whether to pay 7 life; paying lets the spell resolve', () => {
      const { server, ready } = wardGame()
      const warded = ok(server.rules(ready, boltEvent(ready)))
      expect(warded.stack).toHaveLength(0)
      expect(pendingOptionSelection(warded, 'p1')).toMatchObject({
        source: 'Sire of Seven Deaths',
        options: [{ id: 'pay' }, { id: 'decline' }],
        action: { kind: 'ward-life', life: 7 },
      })
      expect(pendingOptionSelection(projectForViewer(warded, 'p1'), 'p1')).toBeDefined()
      for (const viewer of ['p2', 'p3'] as const) {
        expect(pendingOptionSelection(projectForViewer(warded, viewer), 'p1')).toBeUndefined()
      }

      const paid = ok(answer(server, warded, 'pay'))
      expect(paid.players.p1.life).toBe(33)
      expect(paid.stack[0]).toMatchObject({ kind: 'spell', objectId: named(paid, 'Ward spell fixture').id })
      expect(pendingOptionSelection(paid, 'p1')).toBeUndefined()
    })

    test('a host restart restores the open choice and the replayed answer resolves the spell', () => {
      const { server, ready } = wardGame()
      const event = boltEvent(ready)
      const warded = ok(server.rules(ready, event))
      const selection = pendingOptionSelection(warded, 'p1')!

      let journal = createJournal(ready)
      journal = recordAccepted(journal, event)
      const restored = restoreJournal(journal, server.rules).current()
      expect(pendingOptionSelection(restored, 'p1')).toEqual(selection)

      const paid = ok(answer(server, restored, 'pay'))
      expect(paid.players.p1.life).toBe(33)
      expect(paid.stack).toHaveLength(1)
    })
  })
})
