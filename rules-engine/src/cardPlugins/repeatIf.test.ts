import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import {
  controlledLands,
  draw,
  onResolve,
  putLandFromHand,
  repeatIf,
} from './effects'
import { onResolve as onResolvePlugin } from './onResolve'
import { pendingSelectionFor } from '../rules/selectCards'

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const land = (name: string) => cardTemplate(name, { types: ['Land'] })

const lands = (count: number) =>
  Array.from({ length: count }, (_, index) => land(`Field ${index + 1}`))

const resolveRepeatSpell = (
  fieldCount: number,
  extra: { hand?: ReturnType<typeof cardTemplate>[] } = {},
) => {
  const server = createServerGame(
    commanderRules,
    {
      players: 2,
      battlefield: { p1: lands(fieldCount) },
      hands: {
        p1: [
          cardTemplate('Repeat Lands Sage', {
            types: ['Instant'],
            manaCost: '{0}',
            manaValue: 0,
            effects: [onResolve(repeatIf(
              controlledLands({ min: 8 }),
              draw(1),
              putLandFromHand(true),
            ))],
          }),
          ...(extra.hand ?? []),
        ],
      },
      libraries: {
        p1: ['Drawn One', 'Drawn Two', 'Drawn Three'].map((name) =>
          cardTemplate(name, { types: ['Instant'] })),
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
    objectId: named(withMana, 'Repeat Lands Sage').id,
  }))
  return { server, resolved: ok(server.rules(cast, { type: 'resolveTop' })) }
}

const battlefieldLandCount = (state: ReturnType<typeof createServerGame>['state']) =>
  Object.values(state.objects).filter((object) =>
    object.zone === 'battlefield' && object.types.includes('Land') && object.controller === 'p1').length

describe('repeatIf', () => {
  test('seven lands after the first process does not repeat', () => {
    const { resolved } = resolveRepeatSpell(7)
    expect(named(resolved, 'Drawn One').zone).toBe('hand')
    expect(named(resolved, 'Drawn Two').zone).toBe('library')
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
    expect(battlefieldLandCount(resolved)).toBe(7)
  })

  test('eight lands repeats the process once only', () => {
    const { resolved } = resolveRepeatSpell(8)
    expect(named(resolved, 'Drawn One').zone).toBe('hand')
    expect(named(resolved, 'Drawn Two').zone).toBe('hand')
    expect(named(resolved, 'Drawn Three').zone).toBe('library')
    expect(pendingSelectionFor(resolved, 'p1')).toBeUndefined()
    expect(battlefieldLandCount(resolved)).toBe(8)
  })

  test('the second put-land choice still works after the first land enters', () => {
    const { server, resolved } = resolveRepeatSpell(8, {
      hand: [land('Hand Grove'), land('Hand Thicket')],
    })
    const firstChoice = pendingSelectionFor(resolved, 'p1')
    expect(firstChoice?.candidates).toEqual([
      named(resolved, 'Hand Grove').id,
      named(resolved, 'Hand Thicket').id,
    ])
    expect(named(resolved, 'Drawn One').zone).toBe('hand')
    expect(named(resolved, 'Drawn Two').zone).toBe('library')

    const afterFirst = ok(server.rules(resolved, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(resolved, 'Hand Grove').id],
    }))
    expect(named(afterFirst, 'Hand Grove').zone).toBe('battlefield')
    expect(named(afterFirst, 'Hand Grove').tapped).toBe(true)
    expect(battlefieldLandCount(afterFirst)).toBe(9)
    expect(named(afterFirst, 'Drawn Two').zone).toBe('hand')

    const secondChoice = pendingSelectionFor(afterFirst, 'p1')
    expect(secondChoice?.candidates).toEqual([named(afterFirst, 'Hand Thicket').id])

    const afterSecond = ok(server.rules(afterFirst, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [named(afterFirst, 'Hand Thicket').id],
    }))
    expect(named(afterSecond, 'Hand Thicket').zone).toBe('battlefield')
    expect(named(afterSecond, 'Hand Thicket').tapped).toBe(true)
    expect(battlefieldLandCount(afterSecond)).toBe(10)
    expect(named(afterSecond, 'Drawn Three').zone).toBe('library')
    expect(pendingSelectionFor(afterSecond, 'p1')).toBeUndefined()
  })
})
