import { hasKeyword } from '../keywords'
import type Draft from '../draft'
import type { GameObject, Plugin } from '../types'
import {
  isLegendaryCreature,
  noteLegendaryCombatDamageToPlayer,
} from './combatLegendaryDamage'

const dealToObject = (
  draft: Draft,
  source: GameObject | undefined,
  object: GameObject,
  amount: number,
) => {
  if (object.types.includes('Planeswalker')) {
    object.counters.loyalty = Math.max(0, (object.counters.loyalty ?? 0) - amount)
    return
  }
  object.damageMarked += amount
  if (amount > 0 && source && hasKeyword(source, 'deathtouch')) {
    object.deathtouched = true
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
        draft.enqueue({
          type: 'loseLife',
          seat: event.target.player,
          amount: event.amount,
          source: event.sourceId,
        })
        if (event.gainLife) {
          draft.enqueue({
            type: 'gainLife',
            seat: event.gainLife.seat,
            amount: Math.min(event.amount, event.gainLife.max ?? maximum),
            source: event.sourceId,
          })
        }
        return
      }
      const object = draft.object(event.target.objectId)
      if (!object || object.zone !== 'battlefield') return
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
      } else {
        object.damageMarked += event.amount
        const source = draft.objects[event.sourceId]
        if (event.amount > 0 && source && hasKeyword(source, 'deathtouch')) {
          object.deathtouched = true
        }
      }
      if (event.gainLife) {
        draft.enqueue({
          type: 'gainLife',
          seat: event.gainLife.seat,
          amount: Math.min(event.amount, event.gainLife.max ?? Math.max(0, maximum)),
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
      dealToObject(draft, right, left, rightPower)
      dealToObject(draft, left, right, leftPower)
      draft.note(`${left.name} fights ${right.name}`)
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
