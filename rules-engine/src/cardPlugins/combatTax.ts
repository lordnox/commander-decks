import { hasKeyword } from '../keywords'
import { manaModes, poolForChoice } from '../plugins/mana'
import type {
  AttackerDecl,
  GameEvent,
  GameState,
  ManaId,
  ManaPayment,
  PlayerId,
  Plugin,
  TargetRef,
} from '../types'

const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

const defendingPlayer = (
  state: GameState,
  target: TargetRef | PlayerId,
) => {
  if (typeof target === 'string') return target
  return target.kind === 'player'
    ? target.player
    : state.objects[target.objectId]?.controller
}

const battlefieldStatics = (state: GameState) =>
  Object.values(state.objects).flatMap((object) =>
    object.zone === 'battlefield'
      ? (object.effects ?? [])
        .filter((effect) => effect.op === 'static')
        .map((effect) => ({ object, effect }))
      : [])

export const attackTaxAmount = (
  state: GameState,
  attackers: AttackerDecl[],
) => attackers.reduce((total, attacker) => {
  const defender = defendingPlayer(state, attacker.defender)
  if (!defender) return total
  return total + battlefieldStatics(state).reduce((tax, { object, effect }) => {
    if (
      !effect.attackTax
      || object.controller !== defender
      || (effect.attackTax.whileUntapped && object.tapped)
    ) {
      return tax
    }
    return tax + effect.attackTax.amount
  }, 0)
}, 0)

export const attackTaxByDefender = (state: GameState) => {
  const targets: Array<[string, TargetRef | PlayerId]> = [
    ...state.playerOrder.map((seat): [string, PlayerId] => [seat, seat]),
    ...Object.values(state.objects)
      .filter((object) => object.zone === 'battlefield' && object.types.includes('Planeswalker'))
      .map((object): [string, TargetRef] => [
        object.id,
        { kind: 'object', objectId: object.id },
      ]),
  ]
  return Object.fromEntries(targets.flatMap(([id, defender]) => {
    const amount = attackTaxAmount(state, [{ objectId: '', defender }])
    return amount > 0 ? [[id, amount]] : []
  }))
}

export const blockTaxAmount = (
  state: GameState,
  blockerCount: number,
) => blockerCount * battlefieldStatics(state).reduce((total, { object, effect }) => {
  if (
    !effect.blockTax
    || (effect.blockTax.whileAttacking && !object.attacking)
  ) {
    return total
  }
  return total + effect.blockTax.amount
}, 0)

export const blockTaxPerCreature = (state: GameState) => blockTaxAmount(state, 1)

export const combatTaxAmount = (
  state: GameState,
  event: Extract<GameEvent, { type: 'declareAttackers' | 'declareBlockers' }>,
) => event.type === 'declareAttackers'
  ? attackTaxAmount(state, event.attackers)
  : blockTaxAmount(state, event.blockers.length)

const paymentMana = (
  state: GameState,
  seat: PlayerId,
  payment: ManaPayment[],
  excluded: Set<string>,
) => {
  const seen = new Set<string>()
  let amount = MANA_IDS.reduce(
    (total, mana) => total + (state.players[seat]?.mana[mana] ?? 0),
    0,
  )
  for (const choice of payment) {
    if (seen.has(choice.objectId)) return 'a mana source can only be used once'
    seen.add(choice.objectId)
    const object = state.objects[choice.objectId]
    if (
      !object
      || object.zone !== 'battlefield'
      || object.controller !== seat
      || object.tapped
      || excluded.has(object.id)
    ) {
      return 'combat tax payment uses an unavailable mana source'
    }
    if (
      object.types.includes('Creature')
      && object.summoningSickness
      && !hasKeyword(object, 'haste', state)
    ) {
      return 'combat tax payment uses a creature with summoning sickness'
    }
    const produced = poolForChoice(object, choice.mana, state)
    if (!produced || manaModes(object, state).length === 0) {
      return 'combat tax payment uses an invalid mana choice'
    }
    amount += MANA_IDS.reduce((sum, mana) => sum + (produced[mana] ?? 0), 0)
  }
  return amount
}

export const combatTax: Plugin = {
  id: 'combatTax',
  legal: ({ state, event }) => {
    if (event.type !== 'declareAttackers' && event.type !== 'declareBlockers') return
    const tax = combatTaxAmount(state, event)
    const payment = event.payment ?? []
    if (tax === 0 && payment.length > 0) return 'combat declaration has no tax to pay'
    if (tax === 0) return
    const excluded = event.type === 'declareAttackers'
      ? new Set(event.attackers.flatMap((attacker) => {
          const object = state.objects[attacker.objectId]
          return object && !hasKeyword(object, 'vigilance', state) ? [object.id] : []
        }))
      : new Set<string>()
    const available = paymentMana(state, event.seat, payment, excluded)
    if (typeof available === 'string') return available
    if (available < tax) return `combat declaration requires {${tax}}`
  },
  apply: ({ state, event, draft }) => {
    if (event.type !== 'declareAttackers' && event.type !== 'declareBlockers') return
    const tax = combatTaxAmount(state, event)
    if (tax === 0) return
    for (const choice of event.payment ?? []) {
      draft.enqueue({
        type: 'tapForMana',
        seat: event.seat,
        objectId: choice.objectId,
        ...(choice.mana ? { mana: choice.mana } : {}),
      })
    }
    draft.enqueue({ type: 'payMana', seat: event.seat, cost: `{${tax}}` })
  },
}
