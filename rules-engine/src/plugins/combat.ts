import type { Plugin, SeatId } from '../types'

const isSeat = (target: string, players: Record<SeatId, unknown>): target is SeatId =>
  target in players

export const combat: Plugin = {
  id: 'combat',
  legal: ({ state, event }) => {
    if (event.type === 'declareAttackers') {
      if (state.step !== 'declareAttackers') return 'attackers can only be declared in declare attackers'
      if (event.seat !== state.active || event.seat !== state.priority) {
        return 'only the active player with priority can declare attackers'
      }

      const seen = new Set<string>()
      for (const declaration of event.attackers) {
        const object = state.objects[declaration.objectId]
        if (seen.has(declaration.objectId)) return 'an attacker can only be declared once'
        seen.add(declaration.objectId)
        if (!object || object.zone !== 'battlefield' || !object.types.includes('Creature')) {
          return 'attacker is not a battlefield creature'
        }
        if (object.controller !== event.seat) return 'attacker is not controlled by that seat'
        if (object.tapped) return 'tapped creatures cannot attack'
        if (object.summoningSickness) return 'creatures with summoning sickness cannot attack'
        if (declaration.defender === event.seat) return 'a creature cannot attack its controller'
      }
    }

    if (event.type === 'declareBlockers') {
      if (state.step !== 'declareBlockers') return 'blockers can only be declared in declare blockers'
      const attackers = Object.values(state.objects).filter(
        (object) => object.zone === 'battlefield' && object.attacking === event.seat,
      )
      if (attackers.length === 0) return 'seat is not a defending player'

      const blockerIds = new Set<string>()
      const attackerIds = new Set<string>()
      for (const declaration of event.blockers) {
        const blocker = state.objects[declaration.blockerId]
        const attacker = state.objects[declaration.attackerId]
        if (blockerIds.has(declaration.blockerId)) return 'a creature can only block once'
        if (attackerIds.has(declaration.attackerId)) return 'only one blocker per attacker is supported'
        blockerIds.add(declaration.blockerId)
        attackerIds.add(declaration.attackerId)
        if (
          !blocker
          || blocker.zone !== 'battlefield'
          || !blocker.types.includes('Creature')
          || blocker.controller !== event.seat
          || blocker.tapped
        ) {
          return 'blocker is not an untapped creature controlled by that seat'
        }
        if (!attacker || attacker.zone !== 'battlefield' || attacker.attacking !== event.seat) {
          return 'attacker is not attacking that seat'
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
  apply: ({ event, draft }) => {
    if (event.type === 'declareAttackers') {
      for (const declaration of event.attackers) {
        const attacker = draft.object(declaration.objectId)
        if (!attacker) continue
        attacker.attacking = declaration.defender
        attacker.tapped = true
      }
      draft.passedInRow = []
      return
    }

    if (event.type === 'declareBlockers') {
      for (const declaration of event.blockers) {
        const blocker = draft.object(declaration.blockerId)
        if (blocker) blocker.blocking = declaration.attackerId
      }
      return
    }

    if (event.type === 'assignCombatDamage') {
      const attackers = Object.values(draft.objects).filter(
        (object) => object.zone === 'battlefield' && object.attacking !== null,
      )
      for (const attacker of attackers) {
        const blockers = Object.values(draft.objects).filter(
          (object) => object.zone === 'battlefield' && object.blocking === attacker.id,
        )
        const amount = attacker.power ?? 0
        if (blockers.length > 0) {
          blockers[0].damageMarked += amount
          continue
        }

        const defender = attacker.attacking
        if (!defender) continue
        draft.players[defender].life -= amount
        if (attacker.commander) {
          const previous = draft.players[defender].commanderDamage[attacker.id] ?? 0
          draft.players[defender].commanderDamage[attacker.id] = previous + amount
        }
      }
      return
    }

    if (event.type === 'dealDamage') {
      if (isSeat(event.target, draft.players)) {
        draft.players[event.target].life -= event.amount
        if (event.combat && event.commander) {
          const previous = draft.players[event.target].commanderDamage[event.sourceId] ?? 0
          draft.players[event.target].commanderDamage[event.sourceId] = previous + event.amount
        }
      } else {
        const object = draft.object(event.target)
        if (object) object.damageMarked += event.amount
      }
    }
  },
}
