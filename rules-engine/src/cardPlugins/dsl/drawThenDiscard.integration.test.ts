import { describe, expect, test } from 'bun:test'
import {
  card,
  choice,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  discard,
  draw,
  objects,
  ref,
  sequence,
  spell,
  chooseCards,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame, projectForViewer } from '../../runtime'
import { ok } from '../../testHelpers'
import { pendingSelectionFor } from '../../rules/selectCards'
import type { GameState } from '../../types'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('drawThenDiscard — integration', () => {

  describe('draw then discard', () => {
    test('draws update hand candidates, hide them from opponents, and resume discard after restore', () => {
      const loot = createDefinitionSnapshot(compileCardRuleDefinition(card([
        spell({
          instructions: [sequence(
            draw({ count: 1, targets: ref('controller') }),
            chooseCards({
              bindChoice: 'discarded',
              chooser: ref('controller'),
              filter: objects({ zone: 'hand', owner: 'you' }),
              count: 1,
            }),
            discard({ by: ref('controller'), targets: choice('discarded') }),
          )],
        }),
      ])))
      const server = createServerGame(commanderRules, {
        players: 2,
        hands: { p1: [cardTemplate('Loot spell', { types: ['Sorcery'], manaCost: '{0}', ruleDefinition: loot }), cardTemplate('Keep me')] },
        libraries: { p1: [cardTemplate('Drawn card')] },
      }, { random: () => 0 })
      const spellObject = named(server.state, 'Loot spell')
      const cast = reduce(server, server.state, { type: 'castSpell', seat: 'p1', objectId: spellObject.id })
      let state = reduce(server, cast, { type: 'resolveTop' })
      const drawn = named(state, 'Drawn card')
      expect(drawn.zone).toBe('hand')
      const pick = pendingSelectionFor(state, 'p1')!
      expect(pick.candidates).toContain(drawn.id)
      expect(pendingSelectionFor(projectForViewer(state, 'p2'), 'p1')).toBeUndefined()
      expect(state.resolution?.phase).toBe('waiting')
      expect(state.stack).toHaveLength(1)
      expect(state.priority).toBeNull()
      const restored = JSON.parse(JSON.stringify(state)) as GameState
      const restoredPick = pendingSelectionFor(restored, 'p1')!
      state = reduce(server, restored, {
        type: 'selectCards', seat: 'p1', selectionId: restoredPick.id, kind: 'choose', count: 1, objectIds: [drawn.id],
      })
      expect(named(state, 'Drawn card').zone).toBe('graveyard')
      expect(state.resolution).toBeUndefined()
      expect(state.stack).toHaveLength(0)
    })
  })
})


test('activated draw then player discard keeps the newly drawn card after discarding an old card', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate("Thrór's Map")] },
    hands: { p1: [cardTemplate('Old card')] },
    libraries: { p1: [cardTemplate('New card')] },
  }, { random: () => 0 })
  const ready = structuredClone(server.state)
  ready.players.p1.mana.C = 2
  const source = ready.zoneOrder.p1.battlefield[0]!
  const announced = ok(server.rules(ready, { type: 'activateAbility', seat: 'p1', objectId: source, abilityId: '$.abilities[1]' }))
  const resolving = ok(server.rules(announced, { type: 'resolveTop' }))
  expect(named(resolving, 'New card').zone).toBe('hand')
  const pick = pendingSelectionFor(resolving, 'p1')!
  expect(pick).toMatchObject({ kind: 'discard', count: 1 })
  const old = named(resolving, 'Old card').id
  const resolved = ok(server.rules(resolving, { type: 'selectCards', seat: 'p1', selectionId: pick.id, kind: 'discard', count: 1, objectIds: [old] }))
  expect(resolved.objects[old].zone).toBe('graveyard')
  expect(resolved.zoneOrder.p1.hand).toEqual([named(resolved, 'New card').id])
  expect(resolved.stack).toHaveLength(0)
})
