import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { ReduceResult } from '../types'
import { DIALOG_CHOSEN, dialogCandidates, pendingDialog } from '../pendingDialog'
import { pendingSearch } from './librarySearch'

const ok = (result: ReduceResult) => {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

const named = (state: import('../types').GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Homer remaining card plugins', () => {
  test('Harrow sacrifices a land and opens a two-basic search', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Harrow', { types: ['Instant'], manaCost: '{2}{G}' })] },
        battlefield: {
          p1: [cardTemplate('Forest', {
            types: ['Land'],
            subtypes: ['Forest'],
            supertypes: ['Basic'],
          })],
        },
        libraries: {
          p1: [
            cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'], supertypes: ['Basic'] }),
            cardTemplate('Island', { types: ['Land'], subtypes: ['Island'], supertypes: ['Basic'] }),
          ],
        },
      },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 }
    const land = ready.zoneOrder.p1.battlefield[0]
    const opened = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Harrow').id,
      sacrifice: [land],
    }))
    expect(opened.objects[land].zone).toBe('graveyard')
    const searching = ok(server.rules(opened, { type: 'resolveTop' }))
    expect(pendingSearch(searching, 'p1')?.source).toBe('Harrow')
    expect(pendingSearch(searching, 'p1')?.max).toBeUndefined()
  })

  test('a bounce land asks which land to return', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Simic Growth Chamber', { types: ['Land'] })] },
        battlefield: {
          p1: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })],
        },
      },
    )
    const entered = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: named(server.state, 'Simic Growth Chamber').id,
    }))
    expect(pendingDialog(entered)?.kind).toBe('bounce-land')
    expect(named(entered, 'Simic Growth Chamber').tapped).toBe(true)
  })

  test('Sakashima copies another creature and turns off the legend rule', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Homer, the Hermit', {
              types: ['Creature'],
              subtypes: ['Crab'],
              supertypes: ['Legendary'],
            }),
          ],
        },
        hands: {
          p1: [
            cardTemplate('Sakashima of a Thousand Faces', {
              types: ['Creature'],
              subtypes: ['Human', 'Rogue'],
              supertypes: ['Legendary'],
            }),
          ],
        },
      },
    )
    const moved = ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Sakashima of a Thousand Faces').id,
      to: 'battlefield',
    }))
    const sakashima = named(moved, 'Sakashima of a Thousand Faces')
    expect(pendingDialog(moved)?.kind).toBe('copy-creature')
    const copied = ok(server.rules(moved, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { objectIds: [named(moved, 'Homer, the Hermit').id] },
    }))
    const clone = copied.objects[sakashima.id]
    expect(clone.name).toBe('Sakashima of a Thousand Faces')
    expect(clone.subtypes).toContain('Crab')
    expect(copied.zoneOrder.p1.battlefield).toHaveLength(2)
  })

  test('an opponent-owned clone entering under your control copies your creature', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Sygg, River Cutthroat', { types: ['Creature'] })],
          p2: [cardTemplate('Homer, the Hermit', { types: ['Creature'] })],
        },
        hands: {
          p2: [cardTemplate('Spark Double', {
            types: ['Creature'],
            power: 0,
            toughness: 0,
          })],
        },
      },
    )
    const spark = named(server.state, 'Spark Double')
    const buried = ok(server.rules(server.state, {
      type: 'move',
      objectId: spark.id,
      to: 'graveyard',
    }))
    const entered = ok(server.rules(buried, {
      type: 'move',
      objectId: spark.id,
      to: 'battlefield',
      controller: 'p1',
    }))
    const dialog = pendingDialog(entered)
    expect(entered.objects[spark.id].controller).toBe('p1')
    expect(entered.objects[spark.id].zone).toBe('battlefield')
    expect(dialog?.seat).toBe('p1')
    expect(dialogCandidates(entered, dialog!).map((object) => object.name)).toEqual([
      'Sygg, River Cutthroat',
    ])
  })

  test('Yarok makes landfall happen an extra time for Aesi', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Forest', { types: ['Land'] })] },
        battlefield: {
          p1: [
            cardTemplate('Aesi, Tyrant of Gyre Strait', { types: ['Creature'] }),
            cardTemplate('Yarok, the Desecrated', { types: ['Creature'] }),
          ],
        },
        libraries: {
          p1: [
            cardTemplate('First', { types: ['Instant'] }),
            cardTemplate('Second', { types: ['Instant'] }),
          ],
        },
      },
    )
    const next = ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: named(server.state, 'Forest').id,
    }))
    expect(next.zoneOrder.p1.hand.map((id) => next.objects[id].name)).toEqual(['First', 'Second'])
  })

  test('Harrow cannot be cast without sacrificing a land', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Harrow', { types: ['Instant'], manaCost: '{2}{G}' })] },
      },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.G = 3
    const result = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Harrow').id,
    })
    expect(result.ok).toBe(false)
  })
})
