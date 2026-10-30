import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate, forest } from '../newGame'
import { createServerGame, projectForViewer } from '../runtime'
import type { ReduceResult } from '../types'
import { continuousEffects } from './continuousEffects'
import { isGoaded } from '../plugins/goad'
import {
  card as dslCard,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  createEffect,
  choice,
  objects,
  permanentEffect,
  players,
  ref,
  revealUntil as dslRevealUntil,
  spell,
  REVEAL_UNTIL_REST,
} from './dsl/v1'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const graveyardNames = (state: ReturnType<typeof createServerGame>['state']) =>
  state.zoneOrder.p1.graveyard
    .map((id) => state.objects[id].name)
    .filter((name) => !name.startsWith('Fixture '))

const creature = (name: string) => cardTemplate(name, { types: ['Creature'] })
const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })

const castCanonicalFixture = (
  name: string,
  instructions: Parameters<typeof spell>[0]['instructions'],
  library: ReturnType<typeof cardTemplate>[],
  options: { players?: number; random?: () => number } = {},
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: options.players ?? 2,
      hands: {
        p1: [cardTemplate(name, {
          types: ['Sorcery'],
          manaCost: '{0}',
          manaValue: 0,
          ruleDefinition: createDefinitionSnapshot(compileCardRuleDefinition(dslCard([spell({
            instructions: instructions ?? [],
          })]))),
        })],
      },
      libraries: { p1: library },
    },
    { random: options.random ?? (() => 0), cardPlugins: [continuousEffects] },
  )
  const withMana = {
    ...server.state,
    players: {
      ...server.state.players,
      p1: { ...server.state.players.p1, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 } },
    },
  }
  const cast = ok(server.rules(withMana, {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(withMana, name).id,
  }))
  const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
  return { server, resolved }
}

describe('revealUntil', () => {
  test('canonical shuffle rest choice survives snapshot cloning', () => {
    const definition = createDefinitionSnapshot(compileCardRuleDefinition(dslCard([spell({
      instructions: [dslRevealUntil({
        targets: ref('controller'),
        match: objects({ zone: 'library', type: 'Creature' }),
        foundTo: 'battlefield',
        rest: REVEAL_UNTIL_REST.shuffle,
      })],
    })])))
    expect(structuredClone(definition)).toEqual(definition)
    expect(definition.definition.abilities[0]).toMatchObject({
      kind: 'spell',
      instructions: [{ kind: 'revealUntil', rest: 'shuffle' }],
    })
  })

  test('non-matches are randomized on the library bottom after a bottomRandom reveal', () => {
    const { resolved } = castCanonicalFixture(
      'Bottom Random',
      [dslRevealUntil({
        targets: ref('controller'),
        match: objects({ zone: 'library', any: [{ type: 'Creature' }, { type: 'Planeswalker' }] }),
        foundTo: 'battlefield',
        rest: REVEAL_UNTIL_REST.bottomRandom,
      })],
      [
        instant('One'),
        instant('Two'),
        creature('Found'),
      ],
      { random: () => 0.99 },
    )
    expect(named(resolved, 'Found').zone).toBe('battlefield')
    expect(resolved.zoneOrder.p1.library).toHaveLength(2)
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['Two', 'One'])
    expect(graveyardNames(resolved)).toEqual(['Bottom Random'])
  })

  test('mills non-matches through the first basic land', () => {
    const { resolved } = castCanonicalFixture(
      'Fixture Hermit Shape',
      [dslRevealUntil({
        targets: ref('controller'),
        match: objects({ zone: 'library', type: 'Land', supertypes: ['Basic'] }),
        foundTo: 'hand',
        rest: REVEAL_UNTIL_REST.graveyard,
      })],
      [
        cardTemplate('Nonbasic', { types: ['Land'] }),
        instant('Spell'),
        forest(),
        creature('After'),
      ],
    )
    expect(graveyardNames(resolved)).toEqual(['Nonbasic', 'Spell'])
    expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name)).toEqual(['Forest'])
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['After'])
  })

  test('mills the entire library when no basic land appears', () => {
    const { resolved } = castCanonicalFixture(
      'Fixture Empty Basic',
      [dslRevealUntil({
        targets: ref('controller'),
        match: objects({ zone: 'library', type: 'Land', supertypes: ['Basic'] }),
        foundTo: 'hand',
        rest: REVEAL_UNTIL_REST.graveyard,
      })],
      [instant('One'), creature('Two'), cardTemplate('Gate', { types: ['Land'] })],
    )
    expect(resolved.zoneOrder.p1.library).toHaveLength(0)
    expect(graveyardNames(resolved)).toEqual(['One', 'Two', 'Gate'])
    expect(resolved.zoneOrder.p1.hand).toHaveLength(0)
  })

  test('puts N creatures on the battlefield and shuffles other revealed cards', () => {
    const { resolved } = castCanonicalFixture(
      'Fixture Shuffle Shape',
      [dslRevealUntil({
        targets: ref('controller'),
        count: 2,
        match: objects({ zone: 'library', type: 'Creature' }),
        foundTo: 'battlefield',
        rest: REVEAL_UNTIL_REST.shuffle,
      })],
      [
        instant('Lead'),
        creature('First'),
        instant('Between'),
        creature('Second'),
        creature('Hidden'),
        instant('Tail'),
      ],
    )
    expect(resolved.zoneOrder.p1.battlefield.map((id) => resolved.objects[id].name))
      .toEqual(['First', 'Second'])
    expect(graveyardNames(resolved)).toEqual([])
    expect(resolved.zoneOrder.p1.library).toHaveLength(4)
    const shuffled = resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)
    expect([...shuffled].sort()).toEqual(['Between', 'Hidden', 'Lead', 'Tail'])
    expect(shuffled).not.toEqual(['Lead', 'Between', 'Hidden', 'Tail'])
  })

  test('opponentCount reveals one creature per opponent in the pod', () => {
    const { resolved } = castCanonicalFixture(
      'Fixture Pod Count',
      [dslRevealUntil({
        targets: ref('controller'),
        count: count(players({ relation: 'opponent' })),
        match: objects({ zone: 'library', type: 'Creature' }),
        foundTo: 'hand',
        rest: REVEAL_UNTIL_REST.graveyard,
      })],
      [
        instant('Noise'),
        creature('A'),
        instant('Gap'),
        creature('B'),
        creature('C'),
        instant('Rest'),
      ],
      { players: 4 },
    )
    expect(resolved.zoneOrder.p1.hand.map((id) => resolved.objects[id].name))
      .toEqual(['A', 'B', 'C'])
    expect(graveyardNames(resolved)).toEqual(['Noise', 'Gap'])
    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name)).toEqual(['Rest'])
  })

  test('revealed cards are public to opponents without exposing unrevealed library order', () => {
    const { resolved } = castCanonicalFixture(
      'Fixture Privacy',
      [dslRevealUntil({
        targets: ref('controller'),
        count: 1,
        match: objects({ zone: 'library', type: 'Creature' }),
        foundTo: 'hand',
        rest: REVEAL_UNTIL_REST.graveyard,
      })],
      [instant('Top'), creature('Shown'), instant('Buried')],
    )
    const opponent = projectForViewer(resolved, 'p2')
    const shownId = named(resolved, 'Shown').id
    expect(opponent.objects[shownId]?.name).toBe('Shown')
    expect(opponent.zoneOrder.p1.library).toEqual([])
    expect(opponent.zoneCounts.p1.library).toBe(1)
    expect(opponent.objects[named(resolved, 'Buried').id]).toBeUndefined()
    expect(resolved.log.some((line) => line.includes('Shown'))).toBe(true)

    expect(resolved.zoneOrder.p1.library.map((id) => resolved.objects[id].name))
      .toEqual(['Buried'])
    expect(resolved.zoneCounts.p1.library).toBe(1)
  })

  test('revealUntil with then goads matches after they enter the battlefield', () => {
    const { resolved } = castCanonicalFixture(
      'Fixture Then Goad',
      [
        dslRevealUntil({
          targets: ref('controller'),
          count: 2,
          match: objects({ zone: 'library', type: 'Creature' }),
          foundTo: 'battlefield',
          rest: REVEAL_UNTIL_REST.shuffle,
          bindFound: 'entered',
        }),
        createEffect({
          targets: choice('entered'),
          effect: { kind: 'goad' },
          duration: permanentEffect(),
        }),
      ],
      [
        instant('Lead'),
        creature('First'),
        instant('Between'),
        creature('Second'),
        creature('Hidden'),
      ],
      { players: 2 },
    )
    const names = ['First', 'Second']
    for (const name of names) {
      const object = named(resolved, name)
      expect(object.zone).toBe('battlefield')
      expect(isGoaded(object)).toBe(true)
    }
    expect(isGoaded(named(resolved, 'Hidden'))).toBe(false)
  })
})
