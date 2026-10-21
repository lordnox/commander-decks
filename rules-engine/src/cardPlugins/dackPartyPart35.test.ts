import { describe, expect, test } from 'bun:test'
import {
  legalActsFor,
  pendingPlayerSelectionFor,
  projectForViewer,
} from '../index'
import { pendingSelectionFor } from '../rules/selectCards'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame } from '../runtime'
import type { GameState } from '../types'
import { activated } from './activated'
import { effectsFor } from './cardRules'
import { encore as encorePlugin } from './encore'
import { giftCast } from './giftCast'
import { onResolve as onResolvePlugin } from './onResolve'
import { ok, resolveStack } from '../testHelpers'
import {
  LEGENDARY_COMBAT_DAMAGE_FROM,
  legendaryCombatDamageFrom,
} from '../plugins/combatLegendaryDamage'

/** Card-only plugins; `gameRules` (draw, discard, triggers, selectCards) already ship in `commanderRules`. */
const plugins = [onResolvePlugin, giftCast, activated, encorePlugin]

const fromRules = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { effects: effectsFor(name), ...extra })

const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })
const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const playCreature = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  name: string,
) => {
  const objectId = named(state, name).id
  return resolveStack(server.rules, ok(server.rules(state, {
    type: 'move',
    objectId,
    to: 'battlefield',
  })))
}

const resolveLootAbility = (
  server: ReturnType<typeof createServerGame>,
  state: GameState,
  abilityId: string,
  artifactName: string,
) => {
  const artifactId = named(state, artifactName).id
  state.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 }
  let current = ok(server.rules(state, {
    type: 'activateAbility',
    seat: 'p1',
    objectId: artifactId,
    abilityId,
  }))
  const fodderId = named(current, 'Hand Fodder').id
  for (let step = 0; step < 8; step += 1) {
    const discardPending = pendingSelectionFor(current, 'p1')
    if (discardPending) {
      current = ok(server.rules(current, {
        type: 'selectCards',
        seat: 'p1',
        kind: discardPending.kind,
        count: discardPending.count,
        objectIds: [fodderId],
      }))
      continue
    }
    if (current.stack.length === 0) break
    if (current.stack[0]?.waiting) break
    current = ok(server.rules(current, { type: 'resolveTop' }))
  }
  return current
}

describe('Dack Party pass-35 cardRules', () => {
  test('Collector\'s Vault loot opens a discard choice then finishes with a Treasure', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [fromRules('Collector\'s Vault', { types: ['Artifact'] })] },
      hands: { p1: [instant('Hand Fodder')] },
      libraries: { p1: [instant('Library Card')] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const resolved = resolveLootAbility(
      server,
      server.state,
      '$.abilities[0]',
      'Collector\'s Vault',
    )
    expect(named(resolved, 'Library Card').zone).toBe('hand')
    expect(resolved.zoneOrder.p1.battlefield.filter((id) =>
      resolved.objects[id].subtypes.includes('Treasure'))).toHaveLength(1)
    expect(projectForViewer(resolved, 'p2').zoneOrder.p1.library).toHaveLength(0)
  })

  test('Daily Bugle Newspaper loot matches Vault pattern', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [fromRules('Daily Bugle Newspaper', { types: ['Artifact'] })] },
      hands: { p1: [instant('Hand Fodder')] },
      libraries: { p1: [instant('Library Card')] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const resolved = resolveLootAbility(
      server,
      server.state,
      '$.abilities[0]',
      'Daily Bugle Newspaper',
    )
    expect(named(resolved, 'Library Card').zone).toBe('hand')
    expect(resolved.zoneOrder.p1.battlefield.filter((id) =>
      resolved.objects[id].subtypes.includes('Treasure'))).toHaveLength(1)
  })

  test('Perch Protection gifts an extra turn and phases out on the promised gift', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: {
        p1: [fromRules('Perch Protection', {
          types: ['Instant'],
          manaCost: '{4}{W}{W}',
        })],
      },
      battlefield: {
        p1: [cardTemplate('Held Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 }
    const spell = named(ready, 'Perch Protection')
    const prevented = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      giftPromised: true,
    }))
    const pending = pendingPlayerSelectionFor(prevented, 'p1')
    expect(pending?.action.kind).toBe('finishGiftCast')
    expect(pendingPlayerSelectionFor(projectForViewer(prevented, 'p2'), 'p1')).toBeUndefined()

    const cast = ok(server.rules(prevented, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pending!.id,
      players: ['p2'],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.zoneOrder.p1.battlefield.filter((id) =>
      resolved.objects[id].subtypes.includes('Bird'))).toHaveLength(4)
    expect(resolved.objects[named(resolved, 'Held Bear').id].phasedOut).toBe(true)
    expect(resolved.extraTurns).toEqual(['p2'])
  })

  test('Blitzball GOOOOAAAALLL! sacrifices and draws two after legendary damage', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: {
        p1: [fromRules('Blitzball', { types: ['Artifact'] })],
      },
      libraries: { p1: [instant('Goal Draw One'), instant('Goal Draw Two')] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ballId = server.state.zoneOrder.p1.battlefield[0]
    expect(legalActsFor(server.state, 'p1').some((action) =>
      action.kind === 'activateAbility'
      && action.objectId === ballId
      && action.abilityId === 'blitzball.goal')).toBe(false)

    const ready = structuredClone(server.state)
    ready.step = 'precombatMain'
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.players.p2.data[LEGENDARY_COMBAT_DAMAGE_FROM] = { p1: true }
    expect(legendaryCombatDamageFrom(ready.players.p2)).toEqual({ p1: true })

    const afterActivate = ok(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: ballId,
      abilityId: 'blitzball.goal',
    }))
    expect(afterActivate.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, afterActivate)
    expect(resolved.zoneCounts.p1.hand).toBe(2)
    expect(resolved.zoneCounts.p1.battlefield).toBe(0)
    expect(resolved.zoneCounts.p1.graveyard).toBe(1)
  })

  test('Belonging makes changelings and exposes encore from the graveyard', () => {
    const server = createServerGame(commanderRules, {
      hands: { p1: [fromRules('Belonging', { types: ['Creature'] })] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const entered = playCreature(server, server.state, 'Belonging')
    const tokens = entered.zoneOrder.p1.battlefield.filter((id) =>
      entered.objects[id].name === 'Shapeshifter')
    expect(tokens.length).toBeGreaterThanOrEqual(3)

    const belongingId = named(entered, 'Belonging').id
    const died = resolveStack(server.rules, ok(server.rules(entered, {
      type: 'move',
      objectId: belongingId,
      to: 'graveyard',
    })))
    const ready = structuredClone(died)
    ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 6 }
    const encoreLegal = legalActsFor(ready, 'p1').some((action) =>
      action.kind === 'activateAbility'
      && action.objectId === belongingId
      && action.abilityId === 'encore')
    expect(encoreLegal).toBe(true)
  })

  test('Perch Protection gift recipient choice survives host restart projection', () => {
    const server = createServerGame(commanderRules, {
      players: 4,
      hands: {
        p1: [fromRules('Perch Protection', {
          types: ['Instant'],
          manaCost: '{4}{W}{W}',
        })],
      },
    }, { random: () => 0.5, cardPlugins: plugins })
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 2, U: 0, B: 0, R: 0, G: 0, C: 4 }
    const spell = named(ready, 'Perch Protection')
    const prevented = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      giftPromised: true,
    }))
    const restarted = structuredClone(prevented)
    const pendingAfter = pendingPlayerSelectionFor(restarted, 'p1')
    expect(pendingAfter?.action.kind).toBe('finishGiftCast')
    const cast = ok(server.rules(restarted, {
      type: 'selectPlayers',
      seat: 'p1',
      selectionId: pendingAfter!.id,
      players: ['p3'],
    }))
    expect(cast.stack[0]?.giftRecipient).toBe('p3')
    expect(pendingPlayerSelectionFor(projectForViewer(cast, 'p2'), 'p1')).toBeUndefined()
  })
})
