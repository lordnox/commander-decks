import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { pendingSelectionFor } from '../rules/selectCards'
import { createServerGame, projectForViewer } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import {
  entersTarget,
  ifYouDoExileFromGraveyard,
} from './effects'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const vandalEffects = () => [
  entersTarget(
    { types: ['Artifact', 'Enchantment'], controller: 'opponent' },
    ifYouDoExileFromGraveyard({ type: 'Creature' }),
  ),
]

const game = () => {
  const server = createServerGame(
    commanderRules,
    {
      hands: {
        p1: [
          cardTemplate('Changeling Scrubber', {
            types: ['Creature'],
            effects: vandalEffects(),
          }),
          cardTemplate('Yard Beast', { types: ['Creature'] }),
          cardTemplate('Yard Rock', { types: ['Artifact'] }),
        ],
      },
      battlefield: {
        p1: [cardTemplate('Home Rock', { types: ['Artifact'] })],
        p2: [
          cardTemplate('Enemy Rock', { types: ['Artifact'] }),
          cardTemplate('Enemy Bear', { types: ['Creature'] }),
          cardTemplate('Enemy Aura', { types: ['Enchantment'] }),
        ],
      },
    },
    { random: () => 0.5 },
  )
  let ready = structuredClone(server.state)
  ready = ok(server.rules(ready, {
    type: 'move',
    objectId: named(ready, 'Yard Beast').id,
    to: 'graveyard',
  }))
  ready = ok(server.rules(ready, {
    type: 'move',
    objectId: named(ready, 'Yard Rock').id,
    to: 'graveyard',
  }))
  return { server, ready }
}

const enterAndTarget = (
  server: ReturnType<typeof createServerGame>,
  ready: GameState,
  targetName: string,
) => {
  const entered = ok(server.rules(ready, {
    type: 'move',
    objectId: named(ready, 'Changeling Scrubber').id,
    to: 'battlefield',
  }))
  return ok(server.rules(entered, {
    type: 'selectCards',
    seat: 'p1',
    kind: 'choose',
    count: 1,
    objectIds: [named(entered, targetName).id],
  }))
}

describe('optional graveyard exile then exile the targeted permanent', () => {

  test('declining the graveyard exile leaves the targeted permanent in play', () => {
    const { server, ready } = game()
    const targeted = enterAndTarget(server, ready, 'Enemy Rock')
    const choosing = resolveStack(server.rules, targeted)
    expect(pendingSelectionFor(choosing, 'p1')).toMatchObject({
      kind: 'choose',
      min: 0,
      fromZone: 'graveyard',
    })
    const declined = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(named(declined, 'Enemy Rock').zone).toBe('battlefield')
    expect(named(declined, 'Yard Beast').zone).toBe('graveyard')
  })

  test('exiling a graveyard creature then exiles the targeted permanent', () => {
    const { server, ready } = game()
    const targeted = enterAndTarget(server, ready, 'Enemy Aura')
    const choosing = resolveStack(server.rules, targeted)
    expect(pendingSelectionFor(choosing, 'p1')?.candidates).toContain(
      named(choosing, 'Yard Beast').id,
    )
    expect(pendingSelectionFor(choosing, 'p1')?.candidates).not.toContain(
      named(choosing, 'Yard Rock').id,
    )
    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(choosing, 'Yard Beast').id],
    }))
    expect(named(resolved, 'Yard Beast').zone).toBe('exile')
    expect(named(resolved, 'Enemy Aura').zone).toBe('exile')
  })

  test('illegal target types are rejected', () => {
    const { server, ready } = game()
    const entered = ok(server.rules(ready, {
      type: 'move',
      objectId: named(ready, 'Changeling Scrubber').id,
      to: 'battlefield',
    }))
    const selection = pendingSelectionFor(entered, 'p1')!
    expect(selection.candidates).toEqual(expect.arrayContaining([
      named(entered, 'Enemy Rock').id,
      named(entered, 'Enemy Aura').id,
    ]))
    expect(selection.candidates).not.toContain(named(entered, 'Enemy Bear').id)
    expect(selection.candidates).not.toContain(named(entered, 'Home Rock').id)
    expect(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(entered, 'Enemy Bear').id],
    }).ok).toBe(false)
    expect(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(entered, 'Home Rock').id],
    }).ok).toBe(false)
  })

  test('a host restart preserves an open graveyard exile choice', () => {
    const { server, ready } = game()
    const targeted = enterAndTarget(server, ready, 'Enemy Rock')
    const choosing = resolveStack(server.rules, targeted)
    const selection = pendingSelectionFor(choosing, 'p1')!
    const restarted = structuredClone(choosing)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(selection.id)
    expect(pendingSelectionFor(projectForViewer(restarted, 'p2'), 'p2')).toBeUndefined()
    expect(pendingSelectionFor(projectForViewer(restarted, 'p1'), 'p1')?.id).toBe(selection.id)
    const resolved = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(restarted, 'Yard Beast').id],
    }))
    expect(named(resolved, 'Enemy Rock').zone).toBe('exile')
  })
})
