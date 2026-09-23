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

/** Pass-35 assigned inventory (12 names). */
const INVENTORY: Record<string, 'registered' | 'kernel-only' | 'GAP'> = {
  'Dack Fayden': 'GAP',
  'Helping Hand': 'kernel-only',
  'Collector\'s Vault': 'registered',
  'Daily Bugle Newspaper': 'registered',
  Blitzball: 'registered',
  Belonging: 'registered',
  'Beza, the Bounding Spring': 'registered',
  'Perch Protection': 'registered',
  'Rumor Gatherer': 'GAP',
  'Enduring Innocence': 'GAP',
  'Ori, Plate Stacker': 'GAP',
  'Graaz, Unstoppable Juggernaut': 'GAP',
}

const GAP_REASON: Partial<Record<string, string>> = {
  'Dack Fayden':
    'Pass 1 lacks compose path: revealUntil→battlefield then goad (not goadTargets) '
    + 'and pairDonateToOpponents with runtime objectIds from that reveal.',
  'Rumor Gatherer':
    'Pass 1 lacks controlled-creature-enter trigger with whenResolvedNth (alliance); '
    + 'only landfallResolveNth exists today.',
  'Enduring Innocence':
    'Pass 1 lacks other-creatures-you-control-enter + power≤2 + onceEachTurn; '
    + 'diesReturnAsEnchantment alone is insufficient for full Oracle.',
  'Ori, Plate Stacker':
    'Pass 1 lacks destroy all opponents’ artifacts/enchantments + gain life per destroyed.',
  'Graaz, Unstoppable Juggernaut':
    'Pass 1 lacks static juggernaut combat restrictions and mass P/T/subtype rewrite.',
}

const fromRules = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { effects: effectsFor(name), ...extra })

const instant = (name: string) => cardTemplate(name, { types: ['Instant'] })
const creature = (name: string, extra: Parameters<typeof cardTemplate>[1] = {}) =>
  cardTemplate(name, { types: ['Creature'], ...extra })

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
        selectionId: discardPending.id,
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

describe('Dack Party pass-35 inventory', () => {
  for (const [name, status] of Object.entries(INVENTORY)) {
    test(`${name} — ${status}`, () => {
      const effects = effectsFor(name)
      if (status === 'registered') {
        expect(effects.length).toBeGreaterThan(0)
        return
      }
      if (status === 'kernel-only') {
        expect(effects).toEqual([])
        return
      }
      expect(effects).toEqual([])
      expect(GAP_REASON[name]).toBeTruthy()
    })
  }
})

describe('Dack Party pass-35 cardRules', () => {
  test('Beza draws when an opponent has more cards in hand', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: {
        p1: [fromRules('Beza, the Bounding Spring', { types: ['Creature'] })],
        p2: [instant('Extra'), instant('Spare')],
      },
      libraries: { p1: [instant('Top Draw')] },
    }, { random: () => 0.5 })
    const resolved = playCreature(server, server.state, 'Beza, the Bounding Spring')
    expect(named(resolved, 'Top Draw').zone).toBe('hand')
  })

  test('Beza Fish tokens are blue', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [fromRules('Beza, the Bounding Spring', { types: ['Creature'] })] },
      battlefield: {
        p2: [
          creature('Opponent One', { power: 3, toughness: 3 }),
          creature('Opponent Two', { power: 2, toughness: 2 }),
        ],
      },
    }, { random: () => 0.5 })
    const resolved = playCreature(server, server.state, 'Beza, the Bounding Spring')
    const fishTokens = resolved.zoneOrder.p1.battlefield
      .map((id) => resolved.objects[id])
      .filter((object) => object.subtypes.includes('Fish'))
    expect(fishTokens.length).toBeGreaterThanOrEqual(2)
    for (const token of fishTokens) {
      expect(token.colors).toEqual(['U'])
    }
  })

  test('Collector\'s Vault loot opens a discard choice then finishes with a Treasure', () => {
    const server = createServerGame(commanderRules, {
      battlefield: { p1: [fromRules('Collector\'s Vault', { types: ['Artifact'] })] },
      hands: { p1: [instant('Hand Fodder')] },
      libraries: { p1: [instant('Library Card')] },
    }, { random: () => 0.5, cardPlugins: plugins })
    const resolved = resolveLootAbility(
      server,
      server.state,
      'collectorsVault.loot',
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
      'dailyBugle.loot',
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
    ready.step = 'main1'
    ready.active = 'p1'
    ready.priority = 'p1'
    ready.players.p2.data[LEGENDARY_COMBAT_DAMAGE_FROM] = { p1: true }
    expect(legendaryCombatDamageFrom(ready.players.p2)).toEqual({ p1: true })

    const activated = ok(server.rules(ready, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: ballId,
      abilityId: 'blitzball.goal',
    }))
    expect(activated.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, activated)
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
