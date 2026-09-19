import { expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { activated } from './activated'
import { activate } from './effects'
import { effectsOf } from './cardRules'

const firdochCore = () => cardTemplate('Firdoch Core', {
  types: ['Artifact'],
  oracleText:
    'Changeling (This card is every creature type.)\n'
    + '{T}: Add one mana of any color.\n'
    + '{4}: This artifact becomes a 4/4 artifact creature until end of turn.',
})

const staleFirdochEffect = activate({
  id: 'anyMana.firdoch',
  manaAbility: true,
  costs: { tap: true },
  do: [{ kind: 'addChosenColorMana' }],
})

test.each([
  ['a newly created object', undefined],
  ['an older journal with its embedded activation', [staleFirdochEffect]],
])('Firdoch Core taps for the chosen mana color from %s', (_, effects) => {
  const core = firdochCore()
  core.effects = effects ?? []
  const server = createServerGame(
    commanderRules,
    { battlefield: { p1: [core] } },
    { random: () => 0, cardPlugins: [] },
  )
  const objectId = server.state.zoneOrder.p1.battlefield[0]
  const result = server.rules(server.state, {
    type: 'tapForMana',
    seat: 'p1',
    objectId,
    mana: 'G',
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.state.players.p1.mana.G).toBe(1)
  expect(result.state.objects[objectId].tapped).toBe(true)
})

test('Firdoch Core animates until cleanup without losing its artifact or changeling traits', () => {
  const server = createServerGame(
    commanderRules,
    { battlefield: { p1: [firdochCore()] } },
    { random: () => 0, cardPlugins: [activated] },
  )
  const objectId = server.state.zoneOrder.p1.battlefield[0]
  expect(server.state.objects[objectId]).toMatchObject({
    types: ['Artifact'],
    power: null,
    toughness: null,
  })

  server.state.players.p1.mana.C = 4
  const activationState = ok(server.rules(server.state, {
    type: 'activateAbility',
    abilityId: 'animate.firdochCore',
    seat: 'p1',
    objectId,
  }))
  const animated = resolveStack(server.rules, activationState)
  expect(animated.objects[objectId]).toMatchObject({
    types: ['Artifact', 'Creature'],
    power: 4,
    toughness: 4,
  })
  expect(effectsOf(animated.objects[objectId])).toContainEqual({
    op: 'static',
    allCreatureTypes: true,
  })

  const combat = structuredClone(animated)
  combat.step = 'declareAttackers'
  const attack = server.rules(combat, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId, defender: 'p2' }],
  })
  expect(attack.ok).toBe(true)

  const cleanup = ok(server.rules(
    { ...animated, step: 'end' },
    { type: 'advanceStep' },
  ))
  expect(cleanup.objects[objectId]).toMatchObject({
    types: ['Artifact'],
    power: null,
    toughness: null,
  })

  const tappedForMana = ok(server.rules(cleanup, {
    type: 'tapForMana',
    seat: 'p1',
    objectId,
    mana: 'U',
  }))
  expect(tappedForMana.players.p1.mana.U).toBe(1)
})

test('an artifact that entered this turn remains summoning sick when animated', () => {
  const server = createServerGame(
    commanderRules,
    { hands: { p1: [firdochCore()] } },
    { random: () => 0, cardPlugins: [activated] },
  )
  const objectId = server.state.zoneOrder.p1.hand[0]
  const entered = ok(server.rules(server.state, {
    type: 'move',
    objectId,
    to: 'battlefield',
  }))
  expect(entered.objects[objectId].summoningSickness).toBe(true)

  entered.players.p1.mana.C = 4
  const activationState = ok(server.rules(entered, {
    type: 'activateAbility',
    abilityId: 'animate.firdochCore',
    seat: 'p1',
    objectId,
  }))
  const animated = resolveStack(server.rules, activationState)
  animated.step = 'declareAttackers'

  const attack = server.rules(animated, {
    type: 'declareAttackers',
    seat: 'p1',
    attackers: [{ objectId, defender: 'p2' }],
  })
  expect(attack.ok).toBe(false)
  if (attack.ok) return
  expect(attack.error).toContain('summoning sickness')
})
