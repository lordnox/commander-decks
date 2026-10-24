import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok } from '../testHelpers'
import { pendingSelectionFor } from '../rules/selectCards'
import { choiceEffects } from './choiceEffects'
import { modalSpell } from './modalSpell'
import { onResolve } from './onResolve'

const card = (
  name: string,
  types: string[],
  extra: Parameters<typeof cardTemplate>[1] | string = {},
) => cardTemplate(name, {
  types,
  ...(typeof extra === 'string' ? { manaCost: extra } : extra),
})

const named = (state: ReturnType<typeof createServerGame>['state'], name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const plugins = [onResolve, modalSpell, choiceEffects]

describe('Sin-fall modal and saga behavior', () => {
  test('Frantic Search untaps up to three tapped lands after looting', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            card('Island 1', ['Land'], { subtypes: ['Island'] }),
            card('Island 2', ['Land'], { subtypes: ['Island'] }),
            card('Island 3', ['Land'], { subtypes: ['Island'] }),
            card('Island 4', ['Land'], { subtypes: ['Island'] }),
          ],
        },
        hands: {
          p1: [
            card('Frantic Search', ['Instant'], { manaCost: '{2}{U}' }),
            card('Keep', ['Instant']),
            card('Dump', ['Instant']),
          ],
        },
        libraries: { p1: [card('Drawn One', ['Instant']), card('Drawn Two', ['Instant'])] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 2 }
    for (const island of ['Island 1', 'Island 2', 'Island 3']) {
      named(state, island).tapped = true
    }
    named(state, 'Island 4').tapped = false
    const spell = named(state, 'Frantic Search').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: spell }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    const discard = pendingSelectionFor(state, 'p1')!
    const toDiscard = discard.candidates.slice(0, 2)
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'discard',
      count: 2,
      objectIds: toDiscard,
    }))
    const selection = pendingSelectionFor(state, 'p1')!
    expect(selection).toMatchObject({ kind: 'choose', count: 3, min: 0 })
    const toUntap = selection.candidates.slice(0, 2)
    state = ok(server.rules(state, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 3,
      objectIds: toUntap,
    }))
    expect(toUntap.every((id) => !state.objects[id].tapped)).toBe(true)
    expect(named(state, 'Island 4').tapped).toBe(false)
  })

  test('Summon: Leviathan chapter II draws when a sea creature attacks', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [card('Summon: Leviathan', ['Enchantment', 'Creature'], {
            subtypes: ['Saga', 'Leviathan'],
            manaCost: '{4}{U}{U}',
          })],
        },
        battlefield: {
          p1: [card('Sin', ['Legendary', 'Creature'], {
            subtypes: ['Avatar', 'Leviathan'],
            power: 7,
            toughness: 7,
          })],
        },
        libraries: { p1: [card('Top Card', ['Instant'])] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    let state = structuredClone(server.state)
    state.players.p1.mana = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 4 }
    const leviathan = named(state, 'Summon: Leviathan').id
    state = ok(server.rules(state, { type: 'castSpell', seat: 'p1', objectId: leviathan }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.objects[leviathan].counters.lore).toBe(1)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    state = { ...state, step: 'draw', active: 'p1', priority: 'p1' }
    state = ok(server.rules(state, { type: 'advanceStep' }))
    expect(state.objects[leviathan].counters.lore).toBe(2)
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(state.delayedTriggers).toHaveLength(1)
    const sin = named(state, 'Sin').id
    state.step = 'declareAttackers'
    state.priority = 'p1'
    state = ok(server.rules(state, {
      type: 'declareAttackers',
      seat: 'p1',
      attackers: [{ objectId: sin, defender: 'p2' }],
    }))
    state = ok(server.rules(state, { type: 'resolveTop' }))
    expect(named(state, 'Top Card').zone).toBe('hand')
  })


})
