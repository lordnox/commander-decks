import { hasKeyword } from '../keywords'
import type { GameEvent, GameObject, Plugin } from '../types'
import {
  isLegendaryCreature,
  noteLegendaryCombatDamageToPlayer,
} from './combatLegendaryDamage'
import { recordDamageDealt } from './damageLedger'

/**
 * CR 702.15b: damage from a lifelink source also gains its controller that
 * much life. An explicit `gainLife` on the event (a spell's own wording) wins.
 */
const lifeGainFor = (event: Extract<GameEvent, { type: 'dealDamage' }>, source?: GameObject) => {
  if (event.gainLife) return event.gainLife
  if (event.amount > 0 && source && hasKeyword(source, 'lifelink')) {
    return { seat: source.controller, max: event.amount }
  }
}

/**
 * CR-shaped damage chain:
 * combatDamage → dealDamage → loseLife (players) or marked damage (objects).
 * Prevention replaces an event with null; later steps never fire.
 */
export const damage: Plugin = {
  id: 'damage',
  apply: ({ event, draft }) => {
    if (event.type === 'combatDamage') {
      draft.enqueue({
        type: 'dealDamage',
        sourceId: event.sourceId,
        target: event.target,
        amount: event.amount,
        combat: true,
      })
      return
    }

    if (event.type === 'dealDamage') {
      if (event.target.kind === 'player') {
        if (event.combat === true && event.amount > 0) {
          const source = draft.objects[event.sourceId]
          const victim = draft.players[event.target.player]
          if (victim && isLegendaryCreature(source)) {
            noteLegendaryCombatDamageToPlayer(victim, source!.controller)
          }
        }
        const maximum = Math.max(0, draft.players[event.target.player]?.life ?? 0)
        const source = draft.objects[event.sourceId]
        if (source && hasKeyword(source, 'infect')) {
          // CR 702.90b: infect damage to a player is poison counters, not life loss.
          draft.players[event.target.player].poison += event.amount
        } else {
          draft.enqueue({
            type: 'loseLife',
            seat: event.target.player,
            amount: event.amount,
            source: event.sourceId,
          })
        }
        const gain = lifeGainFor(event, source)
        if (gain) {
          draft.enqueue({
            type: 'gainLife',
            seat: gain.seat,
            amount: Math.min(event.amount, gain.max ?? maximum),
            source: event.sourceId,
          })
        }
        return
      }
      const object = draft.object(event.target.objectId)
      if (!object || object.zone !== 'battlefield') return
      const source = draft.objects[event.sourceId]
      recordDamageDealt(object, source, event.amount)
      const maximum = object.types.includes('Planeswalker')
        ? object.counters.loyalty ?? 0
        : object.types.includes('Battle')
          ? object.counters.defense ?? 0
        : object.toughness ?? 0
      if (object.types.includes('Planeswalker')) {
        object.counters.loyalty = Math.max(0, (object.counters.loyalty ?? 0) - event.amount)
      } else if (object.types.includes('Battle')) {
        draft.enqueue({
          type: 'removeDefenseCounters',
          objectId: object.id,
          amount: event.amount,
          sourceId: event.sourceId,
        })
      } else if (source && hasKeyword(source, 'infect')) {
        // CR 702.90c: infect damage to a creature is -1/-1 counters, not marked damage.
        if (event.amount > 0) {
          draft.enqueue({
            type: 'putCounters',
            objectId: object.id,
            counter: '-1/-1',
            count: event.amount,
          })
        }
      } else {
        object.damageMarked += event.amount
        if (event.amount > 0 && source && hasKeyword(source, 'deathtouch')) {
          object.deathtouched = true
        }
      }
      const gain = lifeGainFor(event, source)
      if (gain) {
        draft.enqueue({
          type: 'gainLife',
          seat: gain.seat,
          amount: Math.min(event.amount, gain.max ?? Math.max(0, maximum)),
          source: event.sourceId,
        })
      }
      return
    }

    if (event.type === 'fight') {
      const left = draft.object(event.leftId)
      const right = draft.object(event.rightId)
      if (
        !left
        || !right
        || left.zone !== 'battlefield'
        || right.zone !== 'battlefield'
        || !left.types.includes('Creature')
        || !right.types.includes('Creature')
      ) return
      const leftPower = Math.max(0, left.power ?? 0)
      const rightPower = Math.max(0, right.power ?? 0)
      draft.enqueue({
        type: 'dealDamage',
        sourceId: right.id,
        target: { kind: 'object', objectId: left.id },
        amount: rightPower,
      })
      draft.enqueue({
        type: 'dealDamage',
        sourceId: left.id,
        target: { kind: 'object', objectId: right.id },
        amount: leftPower,
      })
      draft.note(`${left.name} fights ${right.name}`)
      return
    }

    // CR 400.7: an object that enters the battlefield is new and has been dealt no damage.
    if (event.type === 'move' && event.to === 'battlefield') {
      delete draft.object(event.objectId)?.damageDealtBy
      return
    }

    if (event.type === 'sacrifice') {
      const object = draft.object(event.objectId)
      if (!object || object.zone !== 'battlefield') return
      draft.enqueue({ type: 'move', objectId: object.id, to: 'graveyard' })
      draft.note(`${object.controller} sacrifices ${object.name}`)
      return
    }
  },
}
