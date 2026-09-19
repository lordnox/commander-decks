import { describe, expect, test } from 'bun:test'
import { legalActsFor } from '../actions'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { activated } from './activated'
import { choiceEffects } from './choiceEffects'
import { crew } from './effects'

const hedgeShredder = () => cardTemplate('Hedge Shredder', {
  types: ['Artifact'],
  subtypes: ['Vehicle'],
  power: 5,
  toughness: 5,
  oracleText: [
    'Whenever this Vehicle attacks, you may mill two cards.',
    'Whenever one or more land cards are put into your graveyard from your library, put them onto the battlefield tapped.',
    'Crew 1',
  ].join('\n'),
})

const creature = (name: string, power: number) => cardTemplate(name, {
  types: ['Creature'],
  power,
  toughness: 1,
  summoningSickness: true,
})

const setup = (power = 1) => {
  const server = createServerGame(
    commanderRules,
    {
      battlefield: { p1: [hedgeShredder(), creature('Crewmate', power)] },
      libraries: {
        p1: [
          cardTemplate('First card', { types: ['Instant'] }),
          cardTemplate('Second card', { types: ['Instant'] }),
        ],
      },
      players: 2,
    },
    { random: () => 0.5, cardPlugins: [activated, choiceEffects] },
  )
  const vehicle = Object.values(server.state.objects)
    .find((object) => object.name === 'Hedge Shredder')!
  const crewmate = Object.values(server.state.objects)
    .find((object) => object.name === 'Crewmate')!
  return { server, vehicle, crewmate }
}

describe('crew', () => {
  test('crew(n) rejects a chosen group below its threshold', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Cargo Skiff', {
              types: ['Artifact'],
              subtypes: ['Vehicle'],
              power: 4,
              toughness: 4,
              effects: [crew(3)],
            }),
            creature('Small crewmate', 1),
            creature('Large crewmate', 2),
          ],
        },
        players: 2,
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const vehicle = Object.values(server.state.objects)
      .find((object) => object.name === 'Cargo Skiff')!
    const small = Object.values(server.state.objects)
      .find((object) => object.name === 'Small crewmate')!

    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'crew.3',
      seat: 'p1',
      objectId: vehicle.id,
      choices: [small.id],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('needs 3 total creature power')
  })

  test('requires chosen untapped creatures with enough total power', () => {
    const { server, vehicle, crewmate } = setup(0)
    const action = legalActsFor(server.state, 'p1').find((candidate) =>
      candidate.kind === 'activateAbility' && candidate.abilityId === 'crew.1')

    expect(action).toBeUndefined()

    const result = server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'crew.1',
      seat: 'p1',
      objectId: vehicle.id,
      choices: [crewmate.id],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('insufficient')
  })

  test('legalActsFor exposes crew picks and crewing makes the Vehicle attack', () => {
    const { server, vehicle, crewmate } = setup()
    const action = legalActsFor(server.state, 'p1').find((candidate) =>
      candidate.kind === 'activateAbility' && candidate.abilityId === 'crew.1')

    expect(action).toMatchObject({
      kind: 'activateAbility',
      objectId: vehicle.id,
      abilityId: 'crew.1',
      targetGroups: [{
        purpose: 'cost',
        min: 1,
        targets: [expect.objectContaining({ objectId: crewmate.id })],
      }],
    })

    const activationState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'crew.1',
      seat: 'p1',
      objectId: vehicle.id,
      choices: [crewmate.id],
    }))
    expect(activationState.objects[crewmate.id].tapped).toBe(true)

    const crewed = ok(server.rules(activationState, { type: 'resolveTop' }))
    expect(crewed.objects[vehicle.id]).toMatchObject({
      types: ['Artifact', 'Creature'],
      power: 5,
      toughness: 5,
    })

    crewed.step = 'declareAttackers'
    const attacked = ok(server.rules(crewed, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: vehicle.id, defender: 'p2' }],
    }))
    expect(attacked.stack[0]).toMatchObject({
      kind: 'ability',
      objectId: vehicle.id,
      name: 'Hedge Shredder',
    })

    const offeredMill = ok(server.rules(attacked, { type: 'resolveTop' }))
    const milled = ok(server.rules(offeredMill, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(milled.zoneOrder.p1.graveyard).toHaveLength(2)
  })

  test('the Artifact Creature type change expires during cleanup', () => {
    const { server, vehicle, crewmate } = setup()
    const activationState = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'crew.1',
      seat: 'p1',
      objectId: vehicle.id,
      choices: [crewmate.id],
    }))
    const crewed = ok(server.rules(activationState, { type: 'resolveTop' }))

    const cleaned = ok(server.rules(
      { ...crewed, step: 'end' },
      { type: 'advanceStep' },
    ))

    expect(cleaned.objects[vehicle.id].types).toEqual(['Artifact'])
    expect(cleaned.objects[vehicle.id].continuousEffects).toBeUndefined()
  })

  test('a Vehicle that is currently a creature can pay a crew cost', () => {
    const { server, vehicle, crewmate } = setup()
    const firstActivation = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'crew.1',
      seat: 'p1',
      objectId: vehicle.id,
      choices: [crewmate.id],
    }))
    const crewed = ok(server.rules(firstActivation, { type: 'resolveTop' }))

    const secondActivation = ok(server.rules(crewed, {
      type: 'activateAbility',
      abilityId: 'crew.1',
      seat: 'p1',
      objectId: vehicle.id,
      choices: [vehicle.id],
    }))

    expect(secondActivation.objects[vehicle.id].tapped).toBe(true)
  })
})
