import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, staticAbility } from './v1'

const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([staticAbility({ kind: 'loseLifeOnManaLoss' })])))

test.each([1, 2])('each active mana-loss consequence applies to the actual unspent total (%s)', count => {
  const server = createServerGame(commanderRules, { battlefield: { p1: Array.from({ length: count }, () => cardTemplate('Consequence fixture', { types: ['Artifact'], ruleDefinition: definition })) } }, { random: () => 0 })
  server.state.players.p1.mana.R = 1
  server.state.players.p1.mana.B = 2
  server.state.players.p1.restrictedMana = [{ mana: 'G', sourceId: 'fixture' }]
  let state = ok(server.rules(server.state, { type: 'payMana', seat: 'p1', cost: '{R}' }))
  expect(state.players.p1.life).toBe(40)
  state = ok(server.rules(JSON.parse(JSON.stringify(state)), { type: 'emptyManaPools' }))
  expect(state.players.p1.life).toBe(40 - 3 * count)
  expect(state.players.p2.life).toBe(40)
  expect(state.players.p1.restrictedMana).toEqual([])
  expect(state.stack).toEqual([])
  state = ok(server.rules(state, { type: 'emptyManaPools' }))
  expect(state.players.p1.life).toBe(40 - 3 * count)
})

test('a phased-out or departed source does not apply a mana-loss consequence', () => {
  const server = createServerGame(commanderRules, { battlefield: { p1: [cardTemplate('Consequence fixture', { types: ['Artifact'], ruleDefinition: definition })] } }, { random: () => 0 })
  server.state.objects[server.state.zoneOrder.p1.battlefield[0]!]!.phasedOut = true
  server.state.players.p1.mana.C = 2
  const state = ok(server.rules(server.state, { type: 'emptyManaPools' }))
  expect(state.players.p1.life).toBe(40)
})

test('a catalog mana-rain ability gives both players mana that Yurlok burns when pools empty', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Yurlok of Scorch Thrash')] },
  }, { random: () => 0 })
  const yurlokId = server.state.zoneOrder.p1.battlefield[0]!
  server.state.objects[yurlokId]!.summoningSickness = false
  server.state.players.p1.mana.C = 1

  const rain = ok(server.rules(server.state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: yurlokId,
    abilityId: '$.abilities[2]',
    manaAbility: true,
  }))
  expect(rain.objects[yurlokId]!.tapped).toBe(true)
  expect(rain.players.p1.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })
  expect(rain.players.p2.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })

  const burned = ok(server.rules(rain, { type: 'emptyManaPools' }))
  expect(burned.players.p1.life).toBe(37)
  expect(burned.players.p2.life).toBe(37)
  expect(burned.players.p1.mana).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
  expect(ok(server.rules(burned, { type: 'emptyManaPools' })).players.p1.life).toBe(37)
})

test('the catalog Yurlok mana ability resolves directly without creating a stack item', () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Yurlok of Scorch Thrash')] },
  }, { random: () => 0 })
  const yurlokId = server.state.zoneOrder.p1.battlefield[0]!
  server.state.objects[yurlokId]!.summoningSickness = false
  server.state.players.p1.mana.C = 1

  const result = server.rules(server.state, {
    type: 'activateAbility', seat: 'p1', objectId: yurlokId, abilityId: '$.abilities[2]',
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.stack).toEqual([])
  expect(result.state.players.p1.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })
  expect(result.state.players.p2.mana).toEqual({ W: 0, U: 0, B: 1, R: 1, G: 1, C: 0 })
})
