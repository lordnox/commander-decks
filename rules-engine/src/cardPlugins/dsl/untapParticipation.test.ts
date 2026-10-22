import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok } from '../../testHelpers'
import { card, compileCardRuleDefinition, createDefinitionSnapshot, objects, ref, staticAbility, untapDuringOtherPlayersSteps } from './v1'

const definition = createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(untapDuringOtherPlayersSteps(objects({ among: ref('source') }))),
])))

for (const mode of ['normal', 'stun', 'phased', 'departed', 'skip-own'] as const) {
  test(`other-player untap participation is a turn-based action: ${mode}`, () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      battlefield: { p1: [cardTemplate('Participant fixture', { types: ['Artifact'], tapped: true, ...(mode === 'stun' ? { counters: { stun: 1 } } : {}), ...(mode === 'skip-own' ? { skipNextUntap: true } : {}), ruleDefinition: definition })] },
    }, { random: () => 0 })
    const id = server.state.zoneOrder.p1.battlefield[0]!
    let state = server.state
    if (mode === 'phased') state = ok(server.rules(state, { type: 'phaseOut', objectId: id }))
    if (mode === 'departed') state = ok(server.rules(state, { type: 'move', objectId: id, to: 'graveyard' }))
    state = ok(server.rules({ ...structuredClone(state), step: 'cleanup', priority: null }, { type: 'advanceStep' }))
    expect(state.active).toBe('p2')
    expect(state.step).toBe('untap')
    expect(state.stack).toHaveLength(0)
    if (mode === 'departed') expect(state.objects[id].zone).toBe('graveyard')
    else expect(state.objects[id].tapped).toBe(mode === 'stun' || mode === 'phased')
    if (mode === 'stun') expect(state.objects[id].counters.stun).toBeUndefined()
    if (mode === 'skip-own') expect(state.objects[id].skipNextUntap).toBe(true)
  })
}

test.each(['p1', 'p2'])('overlapping untap grants do not spend multiple stun counters in one untap action (after %s)', active => {
  const grant = createDefinitionSnapshot(compileCardRuleDefinition(card([
    staticAbility(untapDuringOtherPlayersSteps(objects({ zone: 'battlefield', controller: 'you' }))),
  ])))
  const server = createServerGame(commanderRules, {
    players: 2,
    battlefield: { p1: [cardTemplate('First grant', { types: ['Enchantment'], ruleDefinition: grant }), cardTemplate('Second grant', { types: ['Enchantment'], ruleDefinition: grant }), cardTemplate('Participant', { types: ['Artifact'], tapped: true, counters: { stun: 2 } })] },
  }, { random: () => 0 })
  const id = server.state.zoneOrder.p1.battlefield[2]!
  const state = ok(server.rules({ ...server.state, active, step: 'cleanup', priority: null }, { type: 'advanceStep' }))
  expect(state.objects[id].tapped).toBe(true)
  expect(state.objects[id].counters.stun).toBe(1)
})
