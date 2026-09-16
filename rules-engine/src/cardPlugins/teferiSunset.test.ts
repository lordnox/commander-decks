import { commanderRules } from '../formats'
import { cardTemplate, forest, planeswalker } from '../newGame'
import { pendingDialogFor } from '../pendingDialog'
import { replayComparableState } from '../replay'
import { createServerGame } from '../runtime'
import type { GameObject, ReduceResult } from '../types'
import { planeswalker as planeswalkerPlugin } from './planeswalker'
import { teferiSunset } from './teferiSunset'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const teferi = (loyalty = 4) => planeswalker('Teferi, Who Slows the Sunset', 4, {
  counters: { loyalty },
  oracleText:
    '+1: Choose up to one target artifact, up to one target creature, and up to one target land. Untap the chosen permanents you control. Tap the chosen permanents you don’t control. You gain 2 life.\n−2: Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n−7: You get an emblem.',
})

const objectNamed = (state: ReturnType<typeof game>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = (loyalty = 4) => createServerGame(
  commanderRules,
  {
    battlefield: {
      p1: [
        teferi(loyalty),
        cardTemplate('Phial of Galadriel', { types: ['Artifact'], tapped: true }),
        cardTemplate('Second Artifact', { types: ['Artifact'] }),
        { ...forest(), name: 'Shadowy Backstreet', tapped: true },
      ],
      p2: [cardTemplate('Mossborn Hydra', {
        types: ['Creature'],
        power: 2,
        toughness: 2,
      })],
    },
    libraries: {
      p1: ['First', 'Second', 'Third', 'Fourth'].map((name) => cardTemplate(name)),
    },
  },
  { random: () => 0.5, cardPlugins: [planeswalkerPlugin, teferiSunset] },
)

const target = (object: GameObject) => ({ kind: 'object' as const, objectId: object.id })

describe('Teferi, Who Slows the Sunset', () => {
  test('+1 untaps controlled targets, taps opposing targets, and gains life', () => {
    const runtime = game()
    const source = objectNamed(runtime.state, 'Teferi, Who Slows the Sunset')
    const activated = ok(runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'teferi.plus-one',
      seat: 'p1',
      objectId: source.id,
      targets: [
        target(objectNamed(runtime.state, 'Phial of Galadriel')),
        target(objectNamed(runtime.state, 'Mossborn Hydra')),
        target(objectNamed(runtime.state, 'Shadowy Backstreet')),
      ],
    }))
    expect(activated.objects[source.id].counters.loyalty).toBe(5)
    expect(replayComparableState(activated).stack).toEqual([{
      name: 'Teferi, Who Slows the Sunset',
      kind: 'ability',
      controller: 'p1',
      text: '+1 loyalty activation · targeting Phial of Galadriel (p1), '
        + 'Mossborn Hydra (p2), Shadowy Backstreet (p1)',
    }])

    const resolved = ok(runtime.rules(activated, { type: 'resolveTop' }))
    expect(objectNamed(resolved, 'Phial of Galadriel').tapped).toBe(false)
    expect(objectNamed(resolved, 'Shadowy Backstreet').tapped).toBe(false)
    expect(objectNamed(resolved, 'Mossborn Hydra').tapped).toBe(true)
    expect(resolved.players.p1.life).toBe(42)
  })

  test('+1 rejects two targets competing for the same type slot', () => {
    const runtime = game()
    const source = objectNamed(runtime.state, 'Teferi, Who Slows the Sunset')
    const other = objectNamed(runtime.state, 'Second Artifact')

    const result = runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'teferi.plus-one',
      seat: 'p1',
      objectId: source.id,
      targets: [
        target(objectNamed(runtime.state, 'Phial of Galadriel')),
        target(other),
      ],
    })
    expect(result.ok).toBe(false)
  })

  test('−2 opens an exact private top-three choice', () => {
    const runtime = game()
    const source = objectNamed(runtime.state, 'Teferi, Who Slows the Sunset')
    const activated = ok(runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'teferi.minus-two',
      seat: 'p1',
      objectId: source.id,
    }))
    const resolved = ok(runtime.rules(activated, { type: 'resolveTop' }))

    expect(resolved.objects[source.id].counters.loyalty).toBe(2)
    expect(pendingDialogFor(resolved, 'p1')).toMatchObject({
      kind: 'look-top',
      count: 3,
      destinations: ['bottom', 'hand'],
      requirements: { hand: { min: 1, max: 1 } },
    })
  })

  test('−7 untaps and draws during each opponent turn', () => {
    const runtime = game(7)
    const source = objectNamed(runtime.state, 'Teferi, Who Slows the Sunset')
    let state = ok(runtime.rules(runtime.state, {
      type: 'activateAbility',
      abilityId: 'teferi.minus-seven',
      seat: 'p1',
      objectId: source.id,
    }))
    state = ok(runtime.rules(state, { type: 'resolveTop' }))
    expect(state.players.p1.data['teferiSunset.emblems']).toBe(1)

    state.active = 'p1'
    state.step = 'cleanup'
    const beforeHand = state.zoneOrder.p1.hand.length
    state = ok(runtime.rules(state, { type: 'advanceStep' }))
    expect(state.active).toBe('p2')
    expect(objectNamed(state, 'Phial of Galadriel').tapped).toBe(false)
    state = ok(runtime.rules(state, { type: 'advanceStep' }))
    state = ok(runtime.rules(state, { type: 'advanceStep' }))
    expect(state.step).toBe('draw')
    expect(state.zoneOrder.p1.hand).toHaveLength(beforeHand + 1)
  })
})
