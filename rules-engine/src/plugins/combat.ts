import { attackDeclarationBanned } from '../cardPlugins/attackBan'
import { encoreAttackDeclarationError } from '../cardPlugins/encore'
import { hasKeyword, lethalDamage } from '../keywords'
import { attackDeclarationError, defenderLegalForGoadedAttacker } from './goad'
import { cantBlockWith } from './opponentRestrictions'
import { existsOnBattlefield } from './phasing'
import { hasProtectionFromEverything } from './protectionFromEverything'
import type { GameObject, GameState, PlayerId, Plugin, StepId, TargetRef } from '../types'
import type Draft from '../draft'

const targetRef = (target: TargetRef | PlayerId): TargetRef =>
  typeof target === 'string' ? { kind: 'player', player: target } : target

const defendingPlayer = (state: GameState, target: TargetRef | PlayerId) => {
  const defender = targetRef(target)
  if (defender.kind === 'player') return defender.player
  if (defender.kind !== 'object') return undefined
  const object = state.objects[defender.objectId]
  return object?.types.includes('Battle') ? object.protector : object?.controller
}

/** Why `blocker` can't block `attacker` on its own, ignoring what other blockers do (CR 509.1b). */
export const blockRestriction = (state: GameState, blocker: GameObject, attacker: GameObject) => {
  if (
    hasKeyword(attacker, 'flying', state)
    && !hasKeyword(blocker, 'flying', state)
    && !hasKeyword(blocker, 'reach', state)
  ) {
    return 'a creature with flying can only be blocked by creatures with flying or reach'
  }
  if (cantBlockWith(state, blocker)) {
    return `${blocker.name} can't block because an opponent's permanent forbids it`
  }
}

/** CR 510.4: first and double strikers deal damage first; double strikers and everyone without it deal again. */
const dealsDamageIn = (object: GameObject, step: StepId, state: GameState) => {
  const doubleStrike = hasKeyword(object, 'double strike', state)
  return step === 'firstStrikeDamage'
    ? hasKeyword(object, 'first strike', state) || doubleStrike
    : !hasKeyword(object, 'first strike', state) || doubleStrike
}

const enqueueDamage = (draft: Draft, source: GameObject, target: TargetRef, amount: number) => {
  if (amount > 0) draft.enqueue({ type: 'combatDamage', sourceId: source.id, target, amount })
}

/**
 * Split an attacker's damage. Without a choice prompt each blocker in turn
 * takes lethal damage and the last one (or the defender, with trample) takes
 * the rest (CR 510.1c).
 */
const assignAttackerDamage = (draft: Draft, attacker: GameObject, blockers: GameObject[]) => {
  let remaining = Math.max(0, attacker.power ?? 0)
  const defender = attacker.attacking ? targetRef(attacker.attacking) : undefined
  const tramples = hasKeyword(attacker, 'trample', draft)
  if (!attacker.blocked && blockers.length === 0) {
    if (defender) enqueueDamage(draft, attacker, defender, remaining)
    return
  }
  blockers.forEach((blocker, index) => {
    const last = index === blockers.length - 1 && !tramples
    const amount = last ? remaining : Math.min(remaining, lethalDamage(blocker, attacker))
    remaining -= amount
    enqueueDamage(draft, attacker, { kind: 'object', objectId: blocker.id }, amount)
  })
  // A blocked attacker without trample never damages the defender, even if its blockers are gone.
  if (tramples && defender) enqueueDamage(draft, attacker, defender, remaining)
}

export const combat: Plugin = {
  id: 'combat',
  legal: ({ state, event }) => {
    if (event.type === 'declareAttackers') {
      if (state.step !== 'declareAttackers') return 'attackers can only be declared in declare attackers'
      if (event.seat !== state.active || event.seat !== state.priority) {
        return 'only the active player with priority can declare attackers'
      }
      const encoreError = encoreAttackDeclarationError(state, event.seat, event.attackers)
      if (encoreError) return encoreError

      const goadError = attackDeclarationError(state, event.seat, event.attackers)
      if (goadError) return goadError

      const seen = new Set<string>()
      for (const declaration of event.attackers) {
        const object = state.objects[declaration.objectId]
        if (seen.has(declaration.objectId)) return 'an attacker can only be declared once'
        seen.add(declaration.objectId)
        if (!existsOnBattlefield(object) || !object.types.includes('Creature')) {
          return 'attacker is not a battlefield creature'
        }
        if (object.controller !== event.seat) return 'attacker is not controlled by that seat'
        if (object.tapped) return 'tapped creatures cannot attack'
        if (object.summoningSickness && !hasKeyword(object, 'haste', state)) {
          return 'creatures with summoning sickness cannot attack'
        }
        const defender = defendingPlayer(state, declaration.defender)
        if (!defender || !state.players[defender]) return 'defender is not in the game'
        if (defender === event.seat) return 'a creature cannot attack its controller'
        if (state.players[defender].lost) return 'a player who lost cannot be attacked'
        if (!defenderLegalForGoadedAttacker(state, object, declaration.defender)) {
          return 'a goaded creature must attack a player other than the goading player if able'
        }
        const attackBanError = attackDeclarationBanned(state, event.seat, declaration)
        if (attackBanError) return attackBanError
        const declaredTarget = targetRef(declaration.defender)
        if (declaredTarget.kind === 'object') {
          const target = state.objects[declaredTarget.objectId]
          if (
            !target
            || target.zone !== 'battlefield'
            || target.phasedOut
            || (
              !target.types.includes('Planeswalker')
              && !target.types.includes('Battle')
            )
          ) {
            return 'object defender is not a battlefield planeswalker or battle'
          }
        }
      }
    }

    if (event.type === 'declareBlockers') {
      if (state.step !== 'declareBlockers') return 'blockers can only be declared in declare blockers'
      const attackers = Object.values(state.objects).filter(
        (object) =>
          object.zone === 'battlefield'
          && !object.phasedOut
          && object.attacking !== null
          && defendingPlayer(state, object.attacking) === event.seat,
      )
      if (attackers.length === 0) return 'seat is not a defending player'

      const blockerIds = new Set<string>()
      const blockersOf = new Map<string, number>()
      for (const declaration of event.blockers) {
        const blocker = state.objects[declaration.blockerId]
        const attacker = state.objects[declaration.attackerId]
        if (blockerIds.has(declaration.blockerId) || blocker?.blocking) {
          return 'a creature can only block once'
        }
        blockerIds.add(declaration.blockerId)
        blockersOf.set(declaration.attackerId, (blockersOf.get(declaration.attackerId) ?? 0) + 1)
        if (
          !existsOnBattlefield(blocker)
          || !blocker.types.includes('Creature')
          || blocker.controller !== event.seat
          || blocker.tapped
        ) {
          return 'blocker is not an untapped creature controlled by that seat'
        }
        if (
          hasProtectionFromEverything(state, attacker)
          && blocker
        ) {
          return 'a creature with protection from everything cannot be blocked'
        }
        if (
          !existsOnBattlefield(attacker)
          || !attacker.attacking
          || defendingPlayer(state, attacker.attacking) !== event.seat
        ) {
          return 'attacker is not attacking that seat'
        }
        const restriction = blockRestriction(state, blocker, attacker)
        if (restriction) return restriction
      }
      for (const [attackerId, count] of blockersOf) {
        // CR 702.111b: a creature with menace can't be blocked except by two or more creatures.
        if (count < 2 && hasKeyword(state.objects[attackerId], 'menace', state)) {
          return 'a creature with menace must be blocked by two or more creatures'
        }
      }
    }

    if (
      event.type === 'assignCombatDamage'
      && state.step !== 'firstStrikeDamage'
      && state.step !== 'combatDamage'
    ) {
      return 'combat damage can only be assigned in a combat damage step'
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'declareAttackers') {
      for (const declaration of event.attackers) {
        const attacker = draft.object(declaration.objectId)
        if (!attacker) continue
        attacker.attacking = targetRef(declaration.defender)
        if (!hasKeyword(attacker, 'vigilance', state)) attacker.tapped = true
      }
      draft.passedInRow = []
      return
    }

    if (event.type === 'declareBlockers') {
      for (const declaration of event.blockers) {
        const blocker = draft.object(declaration.blockerId)
        if (blocker) blocker.blocking = declaration.attackerId
        const attacker = draft.object(declaration.attackerId)
        if (attacker) attacker.blocked = true
      }
      return
    }

    if (event.type === 'assignCombatDamage') {
      // Every amount is fixed from the board as it stands now; damage is simultaneous.
      const onBattlefield = Object.values(draft.objects).filter(existsOnBattlefield)
      for (const attacker of onBattlefield.filter((object) => object.attacking !== null)) {
        const blockers = onBattlefield.filter((object) => object.blocking === attacker.id)
        if (dealsDamageIn(attacker, draft.step, draft)) assignAttackerDamage(draft, attacker, blockers)
        for (const blocker of blockers) {
          if (!dealsDamageIn(blocker, draft.step, draft)) continue
          enqueueDamage(
            draft,
            blocker,
            { kind: 'object', objectId: attacker.id },
            Math.max(0, blocker.power ?? 0),
          )
        }
      }
    }
  },
}
