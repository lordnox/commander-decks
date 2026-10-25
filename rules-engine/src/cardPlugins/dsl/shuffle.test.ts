import { expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { Plugin } from '../../types'
import { instructionSpell } from './instructionTestSupport'
import { move, objects, players, shuffle } from './v1'

test('moving hands and graveyards before shuffling excludes the resolving spell until final cleanup', () => {
  const sourceZones: string[] = []
  let sourceId: string
  const witness: Plugin = {
    id: 'test.shuffleWitness',
    apply: ({ event, draft }) => {
      if (event.type === 'shuffleLibrary') sourceZones.push(draft.objects[sourceId].zone)
    },
  }
  const server = createServerGame(commanderRules, {
    players: 2,
    hands: {
      p1: [instructionSpell({ instructions: [
        move({ targets: objects({ zone: 'graveyard' }), to: 'library' }),
        move({ targets: objects({ zone: 'hand' }), to: 'library' }),
        shuffle({ targets: players() }),
      ] }), cardTemplate('First hand fixture')],
      p2: [cardTemplate('Second hand fixture')],
    },
    libraries: {
      p1: [cardTemplate('First library fixture'), cardTemplate('First graveyard fixture', { zone: 'graveyard' })],
      p2: [cardTemplate('Second library fixture'), cardTemplate('Second graveyard fixture', { zone: 'graveyard' })],
    },
  }, { random: () => 0, cardPlugins: [witness] })
  sourceId = server.state.zoneOrder.p1.hand[0]
  const original = server.state
  const cast = ok(server.rules(original, { type: 'castSpell', seat: 'p1', objectId: sourceId }))
  expect(cast.objects[sourceId].zone).toBe('stack')
  const resolved = resolveStack(server.rules, cast)

  for (const seat of original.playerOrder) {
    const [libraryId] = original.zoneOrder[seat].library
    const [graveyardId] = original.zoneOrder[seat].graveyard
    const handId = original.zoneOrder[seat].hand.find(id => id !== sourceId)!
    // With random() = 0, Fisher-Yates rotates [library, graveyard, hand].
    expect(resolved.zoneOrder[seat].library).toEqual([graveyardId, handId, libraryId])
    for (const id of [libraryId, graveyardId, handId]) {
      expect(resolved.objects[id]).toMatchObject({ zone: 'library', owner: seat })
    }
    expect(resolved.zoneOrder[seat].hand).toEqual([])
    expect(resolved.zoneOrder[seat].graveyard).toEqual(seat === 'p1' ? [sourceId] : [])
    expect(resolved.log.filter(line => line === `${seat} shuffles`)).toHaveLength(1)
  }
  expect(sourceZones).toEqual(['stack', 'stack'])
  expect(resolved.objects[sourceId].zone).toBe('graveyard')
  expect(resolved.stack).toEqual([])
  expect(resolved.resolution).toBeUndefined()
})
