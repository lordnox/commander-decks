import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { resolveStack } from '../testHelpers'
import type { Plugin, ReduceResult, TargetRef } from '../types'
import {
  branch,
  controllerLife,
  discardCards,
  draw,
  drawAtNextUpkeep,
  gainLife,
  onResolve,
  type CardInstruction,
} from './effects'
import { choiceEffects } from './choiceEffects'
import { onResolve as onResolvePlugin } from './onResolve'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

/** Cast a free instant from p1's hand and resolve it, so its delayed trigger is registered. */
const castDelaySpell = (
  name: string,
  instructions: CardInstruction[],
  options: { cardPlugins?: Plugin[]; targets?: TargetRef[] } = {},
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      hands: {
        p1: [cardTemplate(name, {
          types: ['Instant'],
          manaCost: '{0}',
          manaValue: 0,
          effects: [onResolve(...instructions)],
        })],
      },
      libraries: {
        p1: [cardTemplate('Now'), cardTemplate('Later One'), cardTemplate('Later Two')],
        p2: [cardTemplate('Opp A'), cardTemplate('Opp B'), cardTemplate('Opp C')],
      },
    },
    { random: () => 0.5, cardPlugins: [onResolvePlugin, ...options.cardPlugins ?? []] },
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
    ...(options.targets ? { targets: options.targets } : {}),
  }))
  return { server, resolved: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const nextUpkeep = (
  server: ReturnType<typeof createServerGame>,
  state: ReturnType<typeof createServerGame>['state'],
) => {
  let current = state
  while (current.step !== 'upkeep') {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

describe('runInstructions', () => {
  test('gainLife goes through the life event', () => {
    const spell = cardTemplate('Life Test', {
      types: ['Instant'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [onResolve(gainLife(3))],
    })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [spell] } },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
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
      objectId: named(withMana, 'Life Test').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.players.p1.life).toBe(commanderRules.startingLife + 3)
    expect(resolved.log).toContain(`p1 gains 3 life (${named(resolved, 'Life Test').id})`)
  })

  test('nested if dispatch shares the root buffer and preserves instruction order', () => {
    const spell = cardTemplate('Nested Buffer Test', {
      types: ['Sorcery'],
      manaCost: '{0}',
      manaValue: 0,
      effects: [
        onResolve(
          branch(controllerLife(1), [draw(1)]),
          gainLife(1),
          discardCards(1),
        ),
      ],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell, cardTemplate('Before Draw')] },
        libraries: {
          p1: [cardTemplate('Nested Draw')],
          p2: [cardTemplate('Opponent Card')],
        },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
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
      objectId: named(withMana, 'Nested Buffer Test').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))

    expect(named(resolved, 'Nested Draw').zone).toBe('hand')
    expect(resolved.stack.at(-1)).toMatchObject({ actionId: 'discard' })
    const gainIndex = resolved.log.findIndex((line) => line.includes('gains 1 life'))
    const drawIndex = resolved.log.findIndex((line) => line === 'p1 draws a card')
    expect(gainIndex).toBeGreaterThanOrEqual(0)
    expect(drawIndex).toBeGreaterThan(gainIndex)
  })

  test('drawAtNextUpkeep draws on the next upkeep, which is the next player\'s', () => {
    const { server, resolved } = castDelaySpell(
      'Delay Test',
      [draw(1), drawAtNextUpkeep(2)],
    )
    expect(named(resolved, 'Now').zone).toBe('hand')
    expect(resolved.delayedTriggers).toHaveLength(1)

    const upkeep = nextUpkeep(server, resolved)
    expect(upkeep.active).toBe('p2')
    expect(named(upkeep, 'Later One').zone).toBe('library')
    expect(upkeep.delayedTriggers).toHaveLength(0)

    const state = resolveStack(server.rules, upkeep)
    expect(named(state, 'Later One').zone).toBe('hand')
    expect(named(state, 'Later Two').zone).toBe('hand')
    expect(state.zoneOrder.p1.hand).toHaveLength(3)
  })

  test('drawAtNextUpkeep for a target controller draws for that opponent', () => {
    const { server, resolved } = castDelaySpell(
      'Opponent Delay',
      [drawAtNextUpkeep(2, 'targetController')],
      { targets: [{ kind: 'player', player: 'p2' }] },
    )
    const upkeep = nextUpkeep(server, resolved)

    // CR 603.7d: the creating spell's controller keeps the ability, p2 only draws.
    expect(upkeep.stack[0]).toMatchObject({ kind: 'ability', controller: 'p1' })

    const state = resolveStack(server.rules, upkeep)
    expect(named(state, 'Opp A').zone).toBe('hand')
    expect(named(state, 'Opp B').zone).toBe('hand')
    expect(state.zoneOrder.p1.hand).toHaveLength(0)
    expect(state.zoneOrder.p2.hand).toHaveLength(2)
  })

  test('optional delayed draws open a may-draw dialog', () => {
    const { server, resolved } = castDelaySpell(
      'Optional Delay',
      [drawAtNextUpkeep(1, 'you', true)],
      { cardPlugins: [choiceEffects] },
    )
    let state = ok(server.rules(nextUpkeep(server, resolved), { type: 'resolveTop' }))
    expect(pendingDialog(state)).toMatchObject({ kind: 'may-draw', seat: 'p1', count: 1 })
    state = ok(server.rules(state, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { accepted: true },
    }))
    expect(named(state, 'Now').zone).toBe('hand')
  })

  test('an optional delayed draw asks the opponent who was named as the drawer', () => {
    const { server, resolved } = castDelaySpell(
      'Optional Opponent Delay',
      [drawAtNextUpkeep(1, 'targetController', true)],
      { cardPlugins: [choiceEffects], targets: [{ kind: 'player', player: 'p2' }] },
    )
    const state = ok(server.rules(nextUpkeep(server, resolved), { type: 'resolveTop' }))

    expect(pendingDialog(state)).toMatchObject({
      kind: 'may-draw',
      seat: 'p2',
      source: 'Optional Opponent Delay',
    })
  })
})
