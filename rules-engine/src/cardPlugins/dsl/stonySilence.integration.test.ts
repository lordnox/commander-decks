import { describe, expect, test } from 'bun:test'
import {
  activated,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  prohibitActivation,
  ref,
  staticAbility,
} from './v1'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { availableActions } from '../../actions'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const reduce = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  event: Parameters<typeof server.rules>[1],
) => ok(server.rules(state, event))

describe('stonySilence — integration', () => {

  describe('Stony Silence', () => {
    const stonySilence = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
      staticAbility(prohibitActivation({ abilitySource: { zone: 'battlefield', type: 'Artifact' } })),
    ])))
    const artifactMana = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
      costs: [],
      decisions: { targets: [] },
      instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
    })])))

    test('artifact activations and mana shortcuts are rejected while the restriction is active', () => {
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [
            cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
            cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
          ],
        },
      }, { random: () => 0 })
      const rock = named(server.state, 'Mana Rock')
      const blocked = server.rules(server.state, {
        type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
      })
      expect(blocked.ok).toBe(false)
      const tapBlocked = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: rock.id })
      expect(tapBlocked.ok).toBe(false)
      expect(availableActions(server.state, 'p1').some((action) => action.kind === 'tapForMana' && action.objectId === rock.id)).toBe(false)
    })

    test('an activation already on the stack still resolves after Stony Silence enters', () => {
      const artifactDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
        costs: [],
        decisions: { targets: [] },
        instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 }, targets: ref('controller') }],
      })])))
      const server = createServerGame(commanderRules, {
        players: 2,
        battlefield: {
          p1: [cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactDraw() })],
        },
        libraries: { p1: [cardTemplate('Library Card')] },
      }, { random: () => 0 })
      const rock = named(server.state, 'Mana Rock')
      const handBefore = server.state.zoneCounts.p1.hand
      let state = reduce(server, server.state, {
        type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
      })
      expect(state.stack).toHaveLength(1)
      const silenceId = `obj${state.nextId}`
      state = {
        ...state,
        nextId: state.nextId + 1,
        objects: {
          ...state.objects,
          [silenceId]: {
            ...cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
            id: silenceId,
            zone: 'battlefield',
            controller: 'p1',
            owner: 'p1',
            incarnation: 0,
          },
        },
        zoneOrder: {
          ...state.zoneOrder,
          p1: {
            ...state.zoneOrder.p1,
            battlefield: [...state.zoneOrder.p1.battlefield, silenceId],
          },
        },
      }
      state = reduce(server, state, { type: 'custom', name: 'dslStaticModifiers.sync' })
      const blocked = server.rules(state, {
        type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
      })
      expect(blocked.ok).toBe(false)
      state = resolveStack(server.rules, state)
      expect(state.zoneCounts.p1.hand).toBe(handBefore + 1)
    })
  })
})
