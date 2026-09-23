import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { cardDefinition, effectsFor } from './cardRules'
import { drawHandDifference, enters, entersTapped, ptEqualsLife, tapAll } from './effects'
import { entersTapped as entersTappedPlugin } from './entersTapped'
import { onResolve as onResolvePlugin } from './onResolve'
import { targetedResolve } from './targetedResolve'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const enterBattlefield = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'move',
  objectId: named(state, name).id,
  to: 'battlefield',
})))

describe('plug-dack part 37 card pool', () => {
  test('cardDefinitions stamp expected builders without empty tables', () => {
    expect(effectsFor('Zetalpa, Primal Dawn')).toEqual([])
    expect(cardDefinition('Sandstone Oracle')?.effects).toMatchObject([
      { op: 'trigger', on: 'enters', targets: 'opponent' },
    ])
    expect(cardDefinition('Serra Avatar')?.effects).toEqual([
      ptEqualsLife({ who: 'controller' }),
    ])
    expect(cardDefinition('Soul of Eternity')?.effects).toMatchObject([
      ptEqualsLife({ who: 'controller' }),
      { op: 'activate', id: 'encore' },
    ])
    expect(cardDefinition('Astral Drift')?.effects).toMatchObject([
      { op: 'trigger', on: 'cycle' },
      { op: 'activate', id: 'cycling.astralDrift', cycling: true },
    ])
    expect(cardDefinition('Ondu Skyruins')?.effects).toEqual([entersTapped()])
    expect(cardDefinition('Timeless Dragon')?.effects).toMatchObject([
      { op: 'activate', id: 'cycling.timelessDragon', cycling: true },
    ])
    expect(cardDefinition('Tri-Sentinel, Act of Vengeance')?.effects).toMatchObject([
      { op: 'activate', id: 'unearth' },
    ])
    expect(cardDefinition("Thalia's Lancers")?.effects).toMatchObject([
      {
        op: 'trigger',
        on: 'enters',
        do: [{
          kind: 'searchLibrary',
          spec: {
            min: 0,
            max: 1,
            destination: 'hand',
            reveal: true,
          },
        }],
      },
    ])
  })

  test('Subjugator Angel taps opposing creatures on enter', () => {
    const angel = cardTemplate('Subjugator Angel', {
      types: ['Creature'],
      effects: [enters(tapAll({
        zone: 'battlefield',
        type: 'Creature',
        controller: 'opponent',
      }))],
    })
    const mine = cardTemplate('My Soldier', { types: ['Creature'] })
    const theirs = cardTemplate('Their Soldier', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [angel] },
        battlefield: { p1: [mine], p2: [theirs] },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin, targetedResolve, entersTappedPlugin] },
    )
    const entered = enterBattlefield(server, server.state, 'Subjugator Angel')
    expect(entered.objects[named(entered, 'My Soldier').id].tapped).toBe(false)
    expect(entered.objects[named(entered, 'Their Soldier').id].tapped).toBe(true)
  })

  test('Astral Drift registers cycling and a cycle-triggered delayed blink', () => {
    const driftEffects = effectsFor('Astral Drift')
    expect(driftEffects[0]).toMatchObject({
      op: 'trigger',
      on: 'cycle',
      do: [{
        kind: 'blink',
        optional: true,
        when: 'nextEndStep',
        filter: { zone: 'battlefield', type: 'Creature' },
      }],
    })
    expect(driftEffects[1]).toMatchObject({
      op: 'activate',
      id: 'cycling.astralDrift',
      cycling: true,
    })
  })

  test('Soul of Eternity registers life-total CDA and encore', () => {
    const soul = cardTemplate('Soul of Eternity', {
      types: ['Creature'],
      power: 0,
      toughness: 0,
      effects: effectsFor('Soul of Eternity'),
    })
    expect(soul.effects).toMatchObject([
      ptEqualsLife({ who: 'controller' }),
      { op: 'activate', zone: 'graveyard', id: 'encore' },
    ])
  })

  test('drawHandDifference builder stays clone-safe in Sandstone wiring', () => {
    expect(structuredClone(drawHandDifference())).toEqual({ kind: 'drawHandDifference' })
  })
})
