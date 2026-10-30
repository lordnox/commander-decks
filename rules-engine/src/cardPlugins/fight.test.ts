import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, enters, fight as dslFight, objects, ref, select, target, whenever } from './dsl/v1'
import { activated } from './activated'
import { fight } from './fight'

const fightOnEntry = createDefinitionSnapshot(compileCardRuleDefinition(card([
  whenever(enters({ filter: ref('self') }), {
    decisions: { targets: [select({ filter: objects({ zone: 'battlefield', type: 'Creature', controller: 'opponent' }), min: 0, max: 1 })] },
    instructions: [dslFight({ left: ref('source'), right: target(0) })],
  }),
])))

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('fight', () => {
  test('Apex Altisaur asks to fight an opposing creature', () => {
    const apex = cardTemplate('Fight fixture', {
      types: ['Creature'],
      power: 10,
      toughness: 10,
      ruleDefinition: fightOnEntry,
    })
    const prey = cardTemplate('Grizzly Bears', {
      types: ['Creature'],
      power: 2,
      toughness: 2,
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [apex] }, battlefield: { p2: [prey] } },
      { random: () => 0.5, cardPlugins: [fight] },
    )
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Fight fixture').id,
      to: 'battlefield',
    })))
    const selection = pendingSelectionFor(entered, 'p1')
    expect(selection?.candidates).toContain(named(entered, 'Grizzly Bears').id)
    expect(selection?.candidates).toHaveLength(1)
    const chosen = ok(server.rules(entered, {
      type: 'selectCards', seat: 'p1', selectionId: selection!.id,
      kind: 'choose', count: selection!.count,
      objectIds: [named(entered, 'Grizzly Bears').id],
    }))
    const fought = resolveStack(server.rules, chosen)
    expect(fought.objects[named(fought, 'Grizzly Bears').id].zone).toBe('graveyard')
    expect(fought.objects[named(fought, 'Fight fixture').id].damageMarked).toBe(2)
  })

  test('Triangle of War fights two targeted creatures', () => {
    const triangle = cardTemplate('Triangle of War', { types: ['Artifact'] })
    const ape = cardTemplate('Kogla, the Titan Ape', { types: ['Creature'], power: 7, toughness: 6 })
    const bear = cardTemplate('Grizzly Bears', { types: ['Creature'], power: 2, toughness: 2 })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [triangle, ape], p2: [bear] } },
      { random: () => 0.5, cardPlugins: [activated, fight] },
    )
    const withMana = {
      ...server.state,
      players: {
        ...server.state.players,
        p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 } },
      },
    }
    const activatedTriangle = ok(server.rules(withMana, {
      type: 'activateAbility',
      abilityId: '$.abilities[0]',
      seat: 'p1',
      objectId: named(withMana, 'Triangle of War').id,
      targetClauses: [
        [{ kind: 'object', objectId: named(withMana, 'Kogla, the Titan Ape').id }],
        [{ kind: 'object', objectId: named(withMana, 'Grizzly Bears').id }],
      ],
    }))
    // CR 602.2/608.2 — fight damage happens when the ability resolves.
    expect(activatedTriangle.objects[named(activatedTriangle, 'Grizzly Bears').id].zone)
      .toBe('battlefield')
    expect(activatedTriangle.stack[0]).toMatchObject({ kind: 'ability', abilityId: '$.abilities[0]' })
    const resolved = ok(server.rules(activatedTriangle, { type: 'resolveTop' }))
    expect(resolved.objects[named(resolved, 'Grizzly Bears').id].zone).toBe('graveyard')
  })
})
