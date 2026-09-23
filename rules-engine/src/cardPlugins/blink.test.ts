import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import type { GameState, Plugin } from '../types'
import { pendingSelectionFor } from '../rules/selectCards'
import { activated } from './activated'
import {
  activate,
  blink,
  enters,
  entersTarget,
  onResolve,
  targetOnResolve,
} from './effects'
import { blinkPlugin } from './blink'
import { onResolve as onResolvePlugin } from './onResolve'
import { targetedResolve } from './targetedResolve'

const plugins: Plugin[] = [onResolvePlugin, targetedResolve, activated, blinkPlugin]

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const mana = (state: GameState, seat = 'p1') => {
  state.players[seat].mana = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 }
  return state
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

describe('generic blink', () => {
  test('immediate blink returns under owner (Flicker-of-Fate shape)', () => {
    const spell = cardTemplate('Fate Flicker Fixture', {
      types: ['Instant'],
      manaCost: '{W}',
      effects: [
        targetOnResolve(
          'select',
          { types: ['Creature', 'Enchantment'] },
          blink({ returnController: 'owner' }),
        ),
      ],
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell] },
        battlefield: {
          p2: [cardTemplate('Borrowed Idol', { types: ['Artifact', 'Enchantment'] })],
        },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const ready = structuredClone(server.state)
    const idol = named(ready, 'Borrowed Idol')
    idol.controller = 'p1'
    const resolved = castAndResolve(server, ready, 'Fate Flicker Fixture', [
      { kind: 'object', objectId: idol.id },
    ])
    expect(resolved.objects[idol.id]).toMatchObject({
      zone: 'battlefield',
      owner: 'p2',
      controller: 'p2',
    })
  })

  test('optional blink returns under controller (Restoration-Angel shape)', () => {
    const angel = cardTemplate('Restoration Fixture', {
      types: ['Creature'],
      subtypes: ['Angel'],
      effects: [
        enters(
          blink({
            optional: true,
            filter: {
              controller: 'you',
              type: 'Creature',
              excludeSubtypes: ['Angel'],
            },
            returnController: 'controller',
            prompt: 'You may exile a non-Angel creature you control, then return it under your control.',
          }),
        ),
      ],
    })
    const bear = cardTemplate('Blink Bear', { types: ['Creature'], power: 2, toughness: 2 })
    const server = createServerGame(
      commanderRules,
      { hands: { p1: [angel] }, battlefield: { p1: [bear] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const angelId = named(server.state, 'Restoration Fixture').id
    const bearId = named(server.state, 'Blink Bear').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: angelId,
      to: 'battlefield',
    }))
    const afterEtB = resolveStack(server.rules, entered)
    expect(pendingSelectionFor(afterEtB, 'p1')).toMatchObject({ kind: 'choose', min: 0 })

    const chose = ok(server.rules(afterEtB, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [bearId],
    }))
    const resolved = resolveStack(server.rules, chose)
    expect(resolved.objects[bearId]).toMatchObject({
      zone: 'battlefield',
      controller: 'p1',
      owner: 'p1',
    })
  })

  test('delayed blink returns at the next end step (Flickerwisp shape)', () => {
    const wisp = cardTemplate('Endstep Wisp Fixture', {
      types: ['Creature'],
      effects: [
        entersTarget(
          { zone: 'battlefield', other: true },
          blink({ when: 'nextEndStep', returnController: 'owner' }),
        ),
      ],
    })
    const rock = cardTemplate('Blink Rock', { types: ['Artifact'] })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [wisp, rock] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const wispId = named(server.state, 'Endstep Wisp Fixture').id
    const rockId = named(server.state, 'Blink Rock').id
    const entered = ok(server.rules(server.state, {
      type: 'move',
      objectId: wispId,
      to: 'battlefield',
    }))
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
    expect(returned.objects[rockId]).toMatchObject({
      zone: 'battlefield',
      owner: 'p1',
      controller: 'p1',
    })
  })

  test('delayed blink may put a +1/+1 counter on return (Journey-home shape)', () => {
    const spell = cardTemplate('Journey Home Fixture', {
      types: ['Sorcery'],
      manaCost: '{W}',
      effects: [
        targetOnResolve(
          'select',
          { type: 'Creature' },
          blink({ when: 'nextEndStep', plusCounters: 1 }),
        ),
      ],
    })
    const creature = cardTemplate('Journey Cat', {
      types: ['Creature'],
      power: 1,
      toughness: 1,
    })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [spell] },
        battlefield: { p1: [creature] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const catId = named(server.state, 'Journey Cat').id
    const resolved = castAndResolve(server, server.state, 'Journey Home Fixture', [
      { kind: 'object', objectId: catId },
    ])
    expect(resolved.objects[catId].zone).toBe('exile')

    const atEnd = advanceToEndStep(server, resolved)
    const returned = resolveStack(server.rules, atEnd)
    expect(returned.objects[catId]).toMatchObject({ zone: 'battlefield' })
    expect(returned.objects[catId].counters['+1/+1']).toBe(1)
  })

  test('activated sacrifice blink uses the same delayed return (Voyager-Staff shape)', () => {
    const staff = cardTemplate('Voyager Rod Fixture', {
      types: ['Artifact'],
      effects: [
        activate({
          id: 'voyager.blink',
          costs: { mana: '{2}', tap: true, sacrifice: 'self' },
          targets: {
            filter: {
              controller: 'you',
              types: ['Artifact', 'Creature', 'Land'],
            },
          },
          do: [blink({ when: 'nextEndStep', returnController: 'owner' })],
        }),
      ],
    })
    const rock = cardTemplate('Staff Rock', { types: ['Artifact'] })
    const server = createServerGame(
      commanderRules,
      { battlefield: { p1: [staff, rock] } },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const staffId = named(server.state, 'Voyager Rod Fixture').id
    const rockId = named(server.state, 'Staff Rock').id
    const activatedState = ok(server.rules(mana(structuredClone(server.state)), {
      type: 'activateAbility',
      abilityId: 'voyager.blink',
      seat: 'p1',
      objectId: staffId,
      targets: [{ kind: 'object', objectId: rockId }],
    }))
    const resolved = resolveStack(server.rules, activatedState)
    expect(resolved.objects[staffId].zone).toBe('graveyard')
    expect(resolved.objects[rockId].zone).toBe('exile')

    const atEnd = advanceToEndStep(server, resolved)
    const returned = resolveStack(server.rules, atEnd)
    expect(returned.objects[rockId].zone).toBe('battlefield')
  })

  test('optional blink selectCards path can be declined', () => {
    const angel = cardTemplate('Optional Angel Fixture', {
      types: ['Creature'],
      effects: [
        onResolve(
          blink({
            optional: true,
            filter: { controller: 'you', type: 'Creature' },
            returnController: 'controller',
          }),
        ),
      ],
    })
    const bear = cardTemplate('Decline Bear', { types: ['Creature'] })
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [angel] },
        battlefield: { p1: [bear] },
      },
      { random: () => 0.5, cardPlugins: plugins },
    )
    const cast = ok(server.rules(mana(structuredClone(server.state)), {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Optional Angel Fixture').id,
    }))
    const waiting = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(pendingSelectionFor(waiting, 'p1')).toBeDefined()
    const declined = ok(server.rules(waiting, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: [],
    }))
    expect(declined.objects[named(declined, 'Decline Bear').id].zone).toBe('battlefield')
    expect(declined.stack).toHaveLength(0)
  })
})
