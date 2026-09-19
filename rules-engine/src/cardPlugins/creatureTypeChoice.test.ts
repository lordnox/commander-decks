import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { DIALOG_CHOSEN, pendingDialog } from '../pendingDialog'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { creatureTypeChoice } from './creatureTypeChoice'
import { onResolve } from './onResolve'

const named = (state: import('../types').GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const game = (options: Parameters<typeof createServerGame>[1]) =>
  createServerGame(
    commanderRules,
    options,
    { random: () => 0.5, cardPlugins: [creatureTypeChoice, onResolve] },
  )

const choose = (
  server: ReturnType<typeof createServerGame>,
  state: import('../types').GameState,
  type: string,
) => ok(server.rules(state, {
  type: 'custom',
  name: DIALOG_CHOSEN,
  seat: 'p1',
  payload: { modes: [type] },
}))

describe('creature-type choices', () => {
  test('Roaming Throne chooses a type without copying a creature', () => {
    const server = game({
      battlefield: {
        p1: [cardTemplate('Homer, the Hermit', {
          types: ['Creature'],
          subtypes: ['Crab', 'Druid'],
        })],
      },
      hands: {
        p1: [cardTemplate('Roaming Throne', {
          types: ['Artifact', 'Creature'],
          subtypes: ['Golem'],
        })],
      },
    })
    const throne = named(server.state, 'Roaming Throne')
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: throne.id,
      to: 'battlefield',
    })))

    expect(pendingDialog(entered)?.kind).toBe('choose-creature-type')
    expect(pendingDialog(entered)?.options).toContain('Crab')
    const chosen = choose(server, entered, 'Crab')
    expect(chosen.objects[throne.id]).toMatchObject({
      name: 'Roaming Throne',
      chosenType: 'Crab',
      subtypes: ['Golem', 'Crab'],
    })
  })

  test('rejects a creature type that was not offered', () => {
    const server = game({
      hands: {
        p1: [cardTemplate('Roaming Throne', {
          types: ['Artifact', 'Creature'],
          subtypes: ['Golem'],
        })],
      },
    })
    const throne = named(server.state, 'Roaming Throne')
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: throne.id,
      to: 'battlefield',
    })))
    const result = server.rules(entered, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { modes: ['Definitely Not Offered'] },
    })
    expect(result.ok).toBe(false)
  })

  test('Kindred Dominance destroys only other types and respects indestructible', () => {
    const server = game({
      battlefield: {
        p1: [
          cardTemplate('Crab', { types: ['Creature'], subtypes: ['Crab'] }),
          cardTemplate('Indestructible Bear', {
            types: ['Creature'],
            subtypes: ['Bear'],
            oracleText: 'Indestructible',
          }),
        ],
        p2: [cardTemplate('Bear', { types: ['Creature'], subtypes: ['Bear'] })],
      },
      hands: {
        p1: [cardTemplate('Kindred Dominance', { types: ['Sorcery'] })],
      },
    })
    const spell = named(server.state, 'Kindred Dominance')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    }))
    const offered = ok(server.rules(cast, { type: 'resolveTop' }))
    const resolved = choose(server, offered, 'Crab')

    expect(named(resolved, 'Crab').zone).toBe('battlefield')
    expect(named(resolved, 'Indestructible Bear').zone).toBe('battlefield')
    expect(named(resolved, 'Bear').zone).toBe('graveyard')
  })

  test('Raise the Palisade returns creatures outside the chosen type', () => {
    const server = game({
      battlefield: {
        p1: [cardTemplate('Crab', { types: ['Creature'], subtypes: ['Crab'] })],
        p2: [cardTemplate('Bear', { types: ['Creature'], subtypes: ['Bear'] })],
      },
      hands: {
        p1: [cardTemplate('Raise the Palisade', { types: ['Sorcery'] })],
      },
    })
    const spell = named(server.state, 'Raise the Palisade')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
    }))
    const offered = ok(server.rules(cast, { type: 'resolveTop' }))
    const resolved = choose(server, offered, 'Crab')

    expect(named(resolved, 'Crab').zone).toBe('battlefield')
    expect(named(resolved, 'Bear').zone).toBe('hand')
  })
})
