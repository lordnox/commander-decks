import type { GameObject, GameState, PlayerId, Plugin } from '../types'
import { isPhasedOut } from './phasing'
import { activeUntilNextTurnRule, untilNextTurnStillHolds } from './untilNextTurn'

export const playerHasProtectionFromEverything = (state: GameState, seat: PlayerId) =>
  activeUntilNextTurnRule(state, 'protectionFromEverything', seat)

export const objectHasProtectionFromEverything = (object: GameObject | undefined) =>
  Boolean(object?.continuousEffects?.some(
    ({ effect }) => effect.kind === 'protectionFromEverything',
  ))

export const hasProtectionFromEverything = (
  state: GameState,
  object: GameObject | undefined,
  asPlayer?: PlayerId,
) => {
  if (asPlayer && playerHasProtectionFromEverything(state, asPlayer)) return true
  if (!object) return false
  if (objectHasProtectionFromEverything(object)) return true
  return playerHasProtectionFromEverything(state, object.controller)
}

const protectedTarget = (
  state: GameState,
  target: { kind: 'player'; player: PlayerId } | { kind: 'object'; objectId: string },
) => {
  if (target.kind === 'player') {
    return playerHasProtectionFromEverything(state, target.player)
  }
  const object = state.objects[target.objectId]
  return hasProtectionFromEverything(state, object)
}

export const protectionFromEverything: Plugin = {
  id: 'protectionFromEverything',
  legal: ({ state, event }) => {
    if (event.type === 'castSpell' && event.targets) {
      for (const target of event.targets) {
        if (target.kind === 'player' && playerHasProtectionFromEverything(state, target.player)) {
          return `${target.player} has protection from everything`
        }
        if (target.kind === 'object') {
          const object = state.objects[target.objectId]
          if (isPhasedOut(object)) return `${object?.name ?? 'Permanent'} is phased out`
          if (hasProtectionFromEverything(state, object)) {
            return `${object?.name ?? 'Permanent'} has protection from everything`
          }
        }
      }
    }
    if (event.type === 'move' && event.to === 'battlefield') {
      const aura = state.objects[event.objectId]
      if (!aura?.subtypes.includes('Aura') || !aura.attachedTo) return
      const host = state.players[aura.attachedTo]
        ? { kind: 'player' as const, player: aura.attachedTo as PlayerId }
        : state.objects[aura.attachedTo]
          ? { kind: 'object' as const, objectId: aura.attachedTo }
          : undefined
      if (host && protectedTarget(state, host)) {
        return 'cannot enchant or equip a permanent with protection from everything'
      }
    }
  },
  replace: ({ state, event, rule }) => {
    if (rule.pluginId !== 'protectionFromEverything') return
    const seat = rule.params.seat
    if (typeof seat !== 'string' || !untilNextTurnStillHolds(rule, state.turn)) return
    if (event.type === 'dealDamage' && event.target.kind === 'player' && event.target.player === seat) {
      return null
    }
    if (event.type === 'combatDamage' && event.target.kind === 'player' && event.target.player === seat) {
      return null
    }
    if (event.type === 'dealDamage' && event.target.kind === 'object') {
      const object = state.objects[event.target.objectId]
      if (hasProtectionFromEverything(state, object)) return null
    }
  },
}
