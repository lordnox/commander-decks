import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { pendingPlayerSelectionFor } from '../rules/selectPlayers'
import { ok, resolveStack } from '../testHelpers'
import type { PlayerReference } from './dsl/v1'
import {
  card,
  choosePlayer,
  choice as choiceRef,
  compileCardRuleDefinition,
  count,
  createDefinitionSnapshot,
  difference,
  draw,
  objects,
  players,
  ref,
  select,
  self,
  target,
  whenever,
} from './dsl/v1'

const handCard = (name: string) => cardTemplate(name, { types: ['Instant'] })

const definition = (abilities: Parameters<typeof card>[0]) =>
  createDefinitionSnapshot(compileCardRuleDefinition(card(abilities)))

const handDifference = (other: PlayerReference) =>
  difference(
    count(objects({ zone: 'hand', owner: other })),
    count(objects({ zone: 'hand', owner: ref('controller') })),
  )

const tallyGolem = () => cardTemplate('Tally Golem', {
  types: ['Artifact', 'Creature'],
  power: 0,
  toughness: 4,
  ruleDefinition: definition([whenever(self.enters, { instructions: [
    choosePlayer({ chooser: ref('controller'), filter: players({ relation: 'opponent' }), bindChoice: 'other' }),
    draw({ targets: ref('controller'), count: handDifference(choiceRef('other')) }),
  ] })]),
})

const enterBattlefield = (
  server: ReturnType<typeof createServerGame>,
  state: ReturnType<typeof createServerGame>['state'],
  name: string,
) => resolveStack(server.rules, ok(server.rules(state, {
  type: 'move',
  objectId: objectId(state, name),
  to: 'battlefield',
})))

describe('canonical triggered hand-difference choice', () => {
  test('choosing an opponent with a larger hand draws the difference', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: {
          p1: [tallyGolem()],
          p2: [handCard('A'), handCard('B'), handCard('C'), handCard('D'), handCard('E')],
          p3: [handCard('F')],
        },
        libraries: {
          p1: Array.from({ length: 6 }, (_, index) => handCard(`Deck ${index + 1}`)),
        },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Tally Golem')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice).toMatchObject({
      min: 1,
      max: 1,
      candidates: ['p2', 'p3', 'p4'],
    })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(5)
    expect(state.zoneOrder.p2.hand).toHaveLength(5)
  })

  test('choosing an opponent who does not have more cards draws nothing', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: {
          p1: [tallyGolem(), handCard('Held One'), handCard('Held Two')],
          p2: [handCard('Opp One')],
        },
        libraries: { p1: [handCard('Library Top')] },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Tally Golem')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(2)
    expect(state.zoneOrder.p2.hand).toHaveLength(1)
  })

  test('opponents see hand counts but not hidden card identities', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: {
          p1: [tallyGolem()],
          p2: [handCard('Secret A'), handCard('Secret B'), handCard('Secret C')],
        },
      },
      { random: () => 0.5 },
    )
    const entered = enterBattlefield(server, server.state, 'Tally Golem')
    const view = server.project(entered, 'p1')
    expect(view.zoneCounts.p2.hand).toBe(3)
    expect(view.zoneOrder.p2.hand).toEqual([])
    expect(Object.values(view.objects).every((object) => object.owner !== 'p2')).toBe(true)
  })

  test('a host restart preserves an open opponent choice', () => {
    const server = createServerGame(
      commanderRules,
      {
        players: 4,
        hands: {
          p1: [tallyGolem()],
          p2: [handCard('A'), handCard('B'), handCard('C')],
        },
        libraries: {
          p1: Array.from({ length: 4 }, (_, index) => handCard(`Deck ${index + 1}`)),
        },
      },
      { random: () => 0.5 },
    )
    const entered = enterBattlefield(server, server.state, 'Tally Golem')
    const choice = pendingPlayerSelectionFor(entered, 'p1')!
    const restarted = createServerGame(commanderRules, {}, { random: () => 0.5 })
    restarted.state = structuredClone(entered)
    expect(pendingPlayerSelectionFor(restarted.state, 'p1')?.id).toBe(choice.id)
    const finished = ok(server.rules(restarted.state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    expect(resolveStack(server.rules, finished).zoneOrder.p1.hand).toHaveLength(3)
  })

  test('a triggered ability can target an opponent before drawing their hand difference', () => {
    const oracle = cardTemplate('Tally Sphinx', {
      types: ['Artifact', 'Creature'],
      ruleDefinition: definition([whenever(self.enters, {
        decisions: { targets: [select({ filter: players({ relation: 'opponent' }), count: 1 })] },
        instructions: [draw({ targets: ref('controller'), count: handDifference(target(0)) })],
      })]),
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 3,
        hands: {
          p1: [oracle],
          p2: [handCard('P2a'), handCard('P2b'), handCard('P2c')],
          p3: [handCard('P3a')],
        },
        libraries: {
          p1: [handCard('D1'), handCard('D2'), handCard('D3'), handCard('D4')],
        },
      },
      { random: () => 0.5 },
    )
    let state = enterBattlefield(server, server.state, 'Tally Sphinx')
    const choice = pendingPlayerSelectionFor(state, 'p1')!
    expect(choice).toMatchObject({ min: 1, max: 1, candidates: ['p2', 'p3'] })
    state = ok(server.rules(state, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: choice.id,
      players: ['p2'],
    }))
    state = resolveStack(server.rules, state)
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
    expect(state.zoneOrder.p2.hand).toHaveLength(3)
  })
})

const objectId = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!.id
