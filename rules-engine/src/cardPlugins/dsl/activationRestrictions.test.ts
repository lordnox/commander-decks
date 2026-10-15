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
import { activationPermission } from './compiler/announcement'
import { cardTemplate } from '../../newGame'
import { commanderRules } from '../../formats'
import { createServerGame } from '../../runtime'
import { availableActions } from '../../actions'
import { reduceOnce } from '../../kernel'
import { createCatalog } from '../../catalog'

const artifactMana = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
  costs: [],
  decisions: { targets: [] },
  instructions: [{ kind: 'addMana', amount: { G: { kind: 'constant', value: 1 } }, targets: ref('controller') }],
})])))

const artifactDraw = () => createDefinitionSnapshot(compileCardRuleDefinition(card([activated({
  costs: [],
  decisions: { targets: [] },
  instructions: [{ kind: 'draw', count: { kind: 'constant', value: 1 }, targets: ref('controller') }],
})])))

const stonySilence = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(prohibitActivation({ abilitySource: { zone: 'battlefield', type: 'Artifact' } })),
])))

describe('activationRestrictions', () => {
  test('Stony Silence rejects artifact activations and mana shortcuts before costs', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
          cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
        ],
      },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Mana Rock')!
    const blocked = server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
    })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.error).toContain('prohibited')
    const tapBlocked = server.rules(server.state, { type: 'tapForMana', seat: 'p1', objectId: rock.id })
    expect(tapBlocked.ok).toBe(false)
    const actions = availableActions(server.state, 'p1')
    expect(actions.some((action) => action.kind === 'tapForMana' && action.objectId === rock.id)).toBe(false)
  })

  test('abilities already on the stack still resolve after Stony Silence arrives', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactDraw() })],
      },
      libraries: { p1: [cardTemplate('Library Card')] },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Mana Rock')!
    const handBefore = server.state.zoneCounts.p1.hand
    const started = server.rules(server.state, {
      type: 'activateAbility', seat: 'p1', objectId: rock.id, abilityId: '$.abilities[0]',
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.stack).toHaveLength(1)
    const silenceId = `obj${started.state.nextId}`
    started.state.objects[silenceId] = {
      ...cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
      id: silenceId,
      zone: 'battlefield',
      controller: 'p1',
      owner: 'p1',
      incarnation: 0,
    }
    started.state.zoneOrder.p1.battlefield.push(silenceId)
    const catalog = createCatalog(commanderRules.plugins)
    const synced = reduceOnce(started.state, { type: 'custom', name: 'dslStaticModifiers.sync' }, catalog)
    expect(synced.ok).toBe(true)
    if (!synced.ok) return
    expect(activationPermission({ state: synced.state, sourceId: rock.id, payer: 'p1', action: 'activate' })).toContain('prohibited')
    const resolved = server.rules(synced.state, { type: 'resolveTop' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.state.zoneCounts.p1.hand).toBe(handBefore + 1)
  })

  test('phasing out and ability loss drop compiled restrictions; two copies still prohibit', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Silent Law A', { types: ['Enchantment'], ruleDefinition: stonySilence(), phasedOut: true }),
          cardTemplate('Silent Law B', { types: ['Enchantment'], ruleDefinition: stonySilence() }),
          cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
        ],
      },
    }, { random: () => 0 })
    const rock = Object.values(server.state.objects).find((object) => object.name === 'Mana Rock')!
    expect(activationPermission({ state: server.state, sourceId: rock.id, payer: 'p1', action: 'activate' })).toContain('prohibited')
    const phasedOnly = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [
          cardTemplate('Silent Law', { types: ['Enchantment'], ruleDefinition: stonySilence(), phasedOut: true }),
          cardTemplate('Mana Rock', { types: ['Artifact'], ruleDefinition: artifactMana() }),
        ],
      },
    }, { random: () => 0 })
    const phasedRock = Object.values(phasedOnly.state.objects).find((object) => object.name === 'Mana Rock')!
    expect(activationPermission({ state: phasedOnly.state, sourceId: phasedRock.id, payer: 'p1', action: 'activate' })).toBeUndefined()
  })
})
