import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState } from '../types'
import { pendingSelectionFor } from '../rules/selectCards'
import { handlerIdsForNames } from './cardRules'
import { missingCardPlugins } from './index'
import { activated } from './activated'
import { alternateCosts } from './alternateCosts'
import { blinkPlugin } from './blink'
import { choiceEffects } from './choiceEffects'
import { linkedExile } from './linkedExile'
import { targetedResolve } from './targetedResolve'

const dackBlinkNames = [
  'Cloudshift',
  'Ephemerate',
  'Flicker of Fate',
  'Long Road Home',
  'Otherworldly Journey',
  'Flickerwisp',
  'Restoration Angel',
  'Felidar Guardian',
  'Voyager Staff',
  'Guardian of Ghirapur',
  'All-Fates Stalker',
]

const dackBlinkPlugins = [
  targetedResolve,
  blinkPlugin,
  activated,
  linkedExile,
  alternateCosts,
  choiceEffects,
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
) => {
  const cast = ok(server.rules(mana(structuredClone(state)), {
    type: 'castSpell',
    seat: 'p1',
    objectId: named(state, spellName).id,
    ...(targets ? { targets } : {}),
  }))
  return ok(server.rules(cast, { type: 'resolveTop' }))
}

describe('Dack party blink pass 2', () => {
  test('registered cards expose plugin definitions and handler ids for the live host', () => {
    expect(missingCardPlugins(dackBlinkNames)).toEqual([])
    expect(handlerIdsForNames(dackBlinkNames).sort()).toEqual([
      'activated',
      'alternateCosts',
      'blink',
      'blinkValue',
      'choiceEffects',
      'linkedExile',
      'targetedResolve',
    ])
  })

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

  test('Long Road Home puts a +1/+1 counter on return at the next end step', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Long Road Home')] },
      battlefield: {
        p1: [cardTemplate('Road Cat', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const catId = named(server.state, 'Road Cat').id
    const exiled = castAndResolve(server, server.state, 'Long Road Home', [
      { kind: 'object', objectId: catId },
    ])
    expect(exiled.objects[catId].zone).toBe('exile')
    const atEnd = advanceToEndStep(server, exiled)
    const returned = resolveStack(server.rules, atEnd)
    expect(returned.objects[catId].counters['+1/+1']).toBe(1)
  })

  test('Flickerwisp cannot blink itself and returns another permanent at end step', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          cardTemplate('Flickerwisp'),
          cardTemplate('Wisp Rock', { types: ['Artifact'] }),
        ],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const wispId = named(server.state, 'Flickerwisp').id
    const rockId = named(server.state, 'Wisp Rock').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: wispId,
      to: 'battlefield',
    }))
    expect(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [wispId],
    })).toMatchObject({ ok: false })
    const picked = ok(server.rules(entered, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [rockId],
    }))
    const afterBlink = resolveStack(server.rules, picked)
    expect(afterBlink.objects[rockId].zone).toBe('exile')
    const atEnd = advanceToEndStep(server, afterBlink)
    const returned = resolveStack(server.rules, atEnd)
    expect(returned.objects[rockId].zone).toBe('battlefield')
  })

  test('Felidar Guardian optional blink survives host restart and selectCards', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Felidar Guardian', { types: ['Creature'] })] },
      battlefield: { p1: [cardTemplate('Felidar Friend', { types: ['Creature'] })] },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const guardianId = named(server.state, 'Felidar Guardian').id
    const friendId = named(server.state, 'Felidar Friend').id
    const cast = ok(server.rules(mana(structuredClone(server.state)), {
      type: 'castSpell',
      seat: 'p1',
      objectId: guardianId,
    }))
    const waiting = resolveStack(server.rules, ok(server.rules(cast, { type: 'resolveTop' })))
    const selection = pendingSelectionFor(waiting, 'p1')!
    const restarted = structuredClone(waiting)
    expect(pendingSelectionFor(restarted, 'p1')?.id).toBe(selection.id)
    const chose = ok(server.rules(restarted, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [friendId],
    }))
    const resolved = resolveStack(server.rules, chose)
    expect(resolved.objects[friendId].zone).toBe('battlefield')
  })

  test('Restoration Angel cannot blink another Angel', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('Restoration Angel', { types: ['Creature'], subtypes: ['Angel'] })] },
      battlefield: {
        p1: [cardTemplate('Other Angel', {
          types: ['Creature'],
          subtypes: ['Angel'],
        })],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const angelId = named(server.state, 'Restoration Angel').id
    const otherId = named(server.state, 'Other Angel').id
    const cast = ok(server.rules(mana(structuredClone(server.state)), {
      type: 'castSpell',
      seat: 'p1',
      objectId: angelId,
    }))
    const waiting = resolveStack(server.rules, ok(server.rules(cast, { type: 'resolveTop' })))
    const selection = pendingSelectionFor(waiting, 'p1')
    expect(selection?.candidates ?? []).not.toContain(otherId)
  })

  test('All-Fates Stalker cages a non-Assassin until it leaves', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [cardTemplate('All-Fates Stalker')] },
      battlefield: {
        p2: [cardTemplate('Caged Bear', { types: ['Creature'], power: 3, toughness: 3 })],
      },
    }, { random: () => 0.5, players: 3, cardPlugins: dackBlinkPlugins })
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

  test('Voyager Staff cannot target itself', () => {
    const server = createServerGame(commanderRules, {
      battlefield: {
        p1: [
          cardTemplate('Voyager Staff', { types: ['Artifact'] }),
          cardTemplate('Staff Pet', { types: ['Creature'] }),
        ],
      },
    }, { random: () => 0.5, cardPlugins: dackBlinkPlugins })
    const staffId = named(server.state, 'Voyager Staff').id
    const petId = named(server.state, 'Staff Pet').id
    expect(server.rules(mana(structuredClone(server.state)), {
      type: 'activateAbility',
      abilityId: 'voyagerStaff.blink',
      seat: 'p1',
      objectId: staffId,
      targets: [{ kind: 'object', objectId: staffId }],
    })).toMatchObject({ ok: false })
    const activated = ok(server.rules(mana(structuredClone(server.state)), {
      type: 'activateAbility',
      abilityId: 'voyagerStaff.blink',
      seat: 'p1',
      objectId: staffId,
      targets: [{ kind: 'object', objectId: petId }],
    }))
    const resolved = resolveStack(server.rules, activated)
    expect(resolved.objects[staffId].zone).toBe('graveyard')
    expect(resolved.objects[petId].zone).toBe('exile')
  })
})
