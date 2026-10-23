import { describe, expect, test } from 'bun:test'
import { eventsForAvailableAction, legalActsFor } from '../index'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { activated } from './activated'
import { alternateCosts } from './alternateCosts'
import { blinkPlugin } from './blink'
import { choiceEffects } from './choiceEffects'
import { giftCast } from './giftCast'
import { linkedExile } from './linkedExile'
import { onResolve as onResolvePlugin } from './onResolve'
import { spreeCast } from './spreeCast'
import { targetedResolve } from './targetedResolve'

const dackBlinkPlugins = [
  targetedResolve,
  blinkPlugin,
  activated,
  linkedExile,
  alternateCosts,
  choiceEffects,
  giftCast,
  spreeCast,
  onResolvePlugin,
]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mana = (state: GameState, seat = 'p1') => {
  state.players[seat].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  return state
}

const advanceToEndStep = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
) => {
  let current = state
  while (current.step !== 'end') {
    current = ok(server.rules(current, { type: 'advanceStep' }))
  }
  return current
}

const castAndResolve = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  spellName: string,
  targets?: Array<{ kind: 'object'; objectId: string }>,
  extra: { spreeModes?: string[]; giftPromised?: boolean; giftRecipientId?: string } = {},
) => {
  const cast = ok(server.rules(mana(structuredClone(state)), {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, spellName).id,
    ...(targets ? { targets } : {}),
    ...(extra.spreeModes ? { spreeModes: extra.spreeModes } : {}),
    ...(extra.giftPromised
      ? { giftPromised: true, giftRecipient: extra.giftRecipientId ?? 'p2' }
      : {}),
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

describe('Dack party blink pass 2', () => {
  test('Cloudshift returns a stolen creature under your control', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Cloudshift')] },
      battlefield: {
        p2: [cardTemplate('Stolen Cat', { types: ['Creature'], power: 1, toughness: 1 })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const ready = structuredClone(server.state)
    const cat = named(ready, 'Stolen Cat')
    cat.controller = 'p1'
    const resolved = castAndResolve(server, ready, 'Cloudshift', [
      { kind: 'object', objectId: cat.id },
    ])
    expect(resolved.objects[cat.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p2',
      controller: 'p1',
    })
  })

  test('Flicker of Fate blinks an enchantment immediately under its owner', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Flicker of Fate')] },
      battlefield: {
        p2: [cardTemplate('Borrowed Aura', { types: ['Enchantment'] })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const ready = structuredClone(server.state)
    const aura = named(ready, 'Borrowed Aura')
    aura.controller = 'p1'
    const resolved = castAndResolve(server, ready, 'Flicker of Fate', [
      { kind: 'object', objectId: aura.id },
    ])
    expect(resolved.objects[aura.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p2',
      controller: 'p2',
    })
  })

  test('Parting Gust without the gift blinks with a counter at the next end step', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Parting Gust')] },
      battlefield: {
        p2: [cardTemplate('Gusty Fox', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const foxId = named(server.state, 'Gusty Fox').id
    const resolved = castAndResolve(server, server.state, 'Parting Gust', [
      { kind: 'object', objectId: foxId },
    ])
    expect(resolved.objects[foxId].zone).toBe('exile')
    const atEnd = advanceToEndStep(server, resolved)
    const returned = resolveStack(server.rules, atEnd)
    expect(returned.objects[foxId].counters['+1/+1']).toBe(1)
  })

  test('Parting Gust with the gift exiles permanently and creates a tapped Fish', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Parting Gust')] },
      battlefield: {
        p2: [cardTemplate('Gift Target', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const ready = structuredClone(server.state)
    const targetId = named(ready, 'Gift Target').id
    const spell = named(ready, 'Parting Gust')
    const gifted = legalActsFor(ready, 'p1').filter((action) => action.kind === 'castSpell').find((action) =>
      action.objectId === spell.id
      && action.giftPromised
      && action.giftRecipientId === 'p2')!
    const castEvents = eventsForAvailableAction(ready, 'p1', {
      ...gifted, targetObjectIds: [targetId],
    })!
    const cast = castEvents.reduce((state, event) => ok(server.rules(state, event)), ready)
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[targetId].zone).toBe('exile')
    const fish = Object.values(resolved.objects).find((object) =>
      object.name === 'Fish' && object.controller === 'p2')
    expect(fish?.tapped).toBe(true)
    const atEnd = advanceToEndStep(server, resolved)
    const afterEnd = resolveStack(server.rules, atEnd)
    expect(afterEnd.objects[targetId].zone).toBe('exile')
  })

  test('All-Fates Stalker cages a non-Assassin until it leaves', () => {
    const server = createServerGame(commanderRules, {
      players: 3,
      hands: { p1: [cardTemplate('All-Fates Stalker')] },
      battlefield: {
        p2: [cardTemplate('Caged Bear', { types: ['Creature'], power: 3, toughness: 3 })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const stalkerId = named(server.state, 'All-Fates Stalker').id
    const bearId = named(server.state, 'Caged Bear').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: stalkerId,
      to: 'battlefield',
    }))
    const picked = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bearId],
    }))
    const resolved = resolveStack(server.rules, picked)
    expect(resolved.objects[bearId]).toMatchObject({
      zone: 'exile',
      exiledWith: stalkerId,
    })
    const sacrificed = resolveStack(server.rules, ok(server.rules(resolved, {
      type: 'sacrifice',
      objectId: stalkerId,
    })))
    expect(sacrificed.objects[bearId].zone).toBe('battlefield')
  })


})
