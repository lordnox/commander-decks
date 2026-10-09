import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { resolveStack } from '../testHelpers'
import type { Plugin, ReduceResult, TargetRef } from '../types'
import {
  branch,
  activate,
  controllerLife,
  discardCards,
  draw,
  drawAtNextUpkeep,
  gainLife,
  loseLife,
  onResolve,
  type CardInstruction,
} from './effects'
import { choiceEffects } from './choiceEffects'
import { onResolve as onResolvePlugin } from './onResolve'
import { activated } from './activated'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { pendingSelectionFor } from '../rules/selectCards'

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
    const pending = pendingSelectionFor(resolved, 'p1')
    expect(pending?.candidates).toContain(named(resolved, 'Nested Draw').id)
    expect(resolved.stack[0]).toMatchObject({
      name: 'Nested Buffer Test',
    })
    expect(resolved.resolution).toMatchObject({ kind: 'legacy', phase: 'waiting' })
    const gainIndex = resolved.log.findIndex((line) => line.includes('gains 1 life'))
    const drawIndex = resolved.log.findIndex((line) => line === 'p1 draws a card')
    expect(gainIndex).toBeGreaterThanOrEqual(0)
    expect(drawIndex).toBeLessThan(gainIndex)

    const finished = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(resolved, 'Nested Draw').id],
    }))
    expect(named(finished, 'Nested Draw').zone).toBe('graveyard')
    expect(named(finished, 'Nested Buffer Test').zone).toBe('graveyard')
    expect(finished.resolution).toBeUndefined()
  })

  test('all-pass legacy resolution retains its spell and defers SBAs across a choice', () => {
    const spell = cardTemplate('Legacy Suspender', {
      types: ['Sorcery'],
      manaCost: '{0}',
      effects: [onResolve(
        loseLife(41, 'controller'),
        discardCards(1),
        gainLife(42),
      )],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        hands: { p1: [spell, cardTemplate('Legacy Fodder')] },
      },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Legacy Suspender').id,
    }))
    for (let index = 0; index < state.playerOrder.length; index += 1) {
      state = ok(server.rules(state, { type: 'passPriority', seat: state.priority! }))
    }

    expect(state.resolution).toMatchObject({ kind: 'legacy', phase: 'waiting' })
    expect(named(state, 'Legacy Suspender').zone).toBe('stack')
    expect(state.players.p1).toMatchObject({ life: -1, lost: false })
    expect(server.rules(state, { type: 'resolveTop' }).ok).toBe(false)

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(state, 'Legacy Fodder').id],
    }))
    expect(state.players.p1).toMatchObject({ life: 41, lost: false })
    expect(named(state, 'Legacy Suspender').zone).toBe('graveyard')
    expect(state.resolution).toBeUndefined()
  })

  test.each([
    { label: 'left the battlefield', sacrifice: true },
    { label: 'changed controllers', sacrifice: false },
  ])('a suspended ability keeps its captured controller after its source $label', ({ sacrifice }) => {
    const source = cardTemplate('Captured Controller', {
      types: ['Artifact'],
      effects: [activate({
        id: 'captured.resolve',
        costs: sacrifice ? { sacrifice: 'self' } : {},
        do: [discardCards(1), gainLife(2)],
      })],
    })
    const server = createServerGame(
      commanderRules,
      {
        players: 2,
        battlefield: { p1: [source] },
        hands: { p1: [cardTemplate('Ability Fodder')] },
      },
      { random: () => 0.5, cardPlugins: [activated] },
    )
    const sourceId = named(server.state, 'Captured Controller').id
    let state = ok(server.rules(server.state, {
      type: 'activateAbility',
      abilityId: 'captured.resolve',
      seat: 'p1',
      objectId: sourceId,
    }))
    if (!sacrifice) state.objects[sourceId].controller = 'p2'
    state = ok(server.rules(state, { type: 'resolveTop' }))

    expect(pendingSelectionFor(state, 'p1')).toBeDefined()
    expect(pendingSelectionFor(state, 'p2')).toBeUndefined()
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(state, 'Ability Fodder').id],
    }))
    expect(state.players.p1.life).toBe(42)
    expect(state.players.p2.life).toBe(40)
    expect(state.resolution).toBeUndefined()
  })

  test('a chooser concession skips its choice and resumes the independent spell', () => {
    const spell = cardTemplate('Opponent Choice', {
      types: ['Sorcery'],
      manaCost: '{0}',
      effects: [onResolve(discardCards(1, 'target'), gainLife(2))],
    })
    const server = createServerGame(
      commanderRules,
      { players: 3, hands: { p1: [spell], p2: [cardTemplate('Opponent Fodder')] } },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Opponent Choice').id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(pendingSelectionFor(state, 'p2')).toBeDefined()

    state = ok(server.rules(state, { type: 'concede', seat: 'p2' }))
    expect(state.players.p2.lost).toBe(true)
    expect(state.players.p1.life).toBe(42)
    expect(named(state, 'Opponent Choice').zone).toBe('graveyard')
    expect(state.resolution).toBeUndefined()
  })

  test('an unrelated concession leaves another chooser and the resolution intact', () => {
    const spell = cardTemplate('Independent Choice', {
      types: ['Sorcery'],
      manaCost: '{0}',
      effects: [onResolve(discardCards(1), gainLife(2))],
    })
    const server = createServerGame(
      commanderRules,
      { players: 3, hands: { p1: [spell, cardTemplate('Independent Fodder')] } },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Independent Choice').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'concede', seat: 'p2' }))
    expect(state.resolution).toMatchObject({ kind: 'legacy', phase: 'waiting' })
    expect(pendingSelectionFor(state, 'p1')).toBeDefined()

    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 1,
      objectIds: [named(state, 'Independent Fodder').id],
    }))
    expect(state.players.p1.life).toBe(42)
    expect(state.resolution).toBeUndefined()
  })

  test('the controller may concede during its suspended resolution', () => {
    const spell = cardTemplate('Abandoned Choice', {
      types: ['Sorcery'],
      manaCost: '{0}',
      effects: [onResolve(discardCards(1), gainLife(2))],
    })
    const server = createServerGame(
      commanderRules,
      { players: 2, hands: { p1: [spell, cardTemplate('Abandoned Fodder')] } },
      { random: () => 0.5, cardPlugins: [onResolvePlugin] },
    )
    let state = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Abandoned Choice').id,
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = ok(server.rules(state, { type: 'concede', seat: 'p1' }))

    expect(state.players.p1.lost).toBe(true)
    expect(state.resolution).toBeUndefined()
    expect(Object.values(state.objects).some((object) => object.owner === 'p1')).toBe(false)
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
