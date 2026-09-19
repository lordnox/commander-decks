import { payCost } from '../plugins/spells'
import type { GameState, PlayerId, Plugin, StackItem } from '../types'
import { effectsOf } from './cardRules'

export const EXTORT_ABILITY = 'extort.pay'
export const PENDING_EXTORT = 'kernel.pendingExtort'

export type PendingExtort = {
  triggerId: string
  sourceId: string
  source: string
  seat: PlayerId
}

const isPendingExtort = (value: unknown): value is PendingExtort =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as PendingExtort).triggerId === 'string'
  && typeof (value as PendingExtort).sourceId === 'string'
  && typeof (value as PendingExtort).seat === 'string'

export const pendingExtortFor = (
  state: Pick<GameState, 'players'>,
  seat: PlayerId,
) => {
  const value = state.players[seat]?.data[PENDING_EXTORT]
  return isPendingExtort(value) ? value : undefined
}

export const pendingExtort = (state: GameState) => {
  for (const seat of state.playerOrder) {
    const pending = pendingExtortFor(state, seat)
    if (pending) return pending
  }
}

const isExtortSource = (object: { effects?: ReturnType<typeof effectsOf> }) =>
  (object.effects ?? []).some(
    (effect) => effect.op === 'handler' && effect.pluginId === 'extort',
  )

const resolvingExtort = (item: StackItem | undefined) =>
  item?.kind === 'ability' && item.abilityId === EXTORT_ABILITY

const allowedDuringPayment = new Set([
  'tapForMana',
  'addMana',
  'payExtort',
  'authoritativeSync',
  'concede',
])

export const extort: Plugin = {
  id: 'extort',
  legal: ({ state, event }) => {
    const pending = pendingExtort(state)
    if (pending && !allowedDuringPayment.has(event.type)) {
      return `${pending.seat} must choose whether to pay extort`
    }
    if (event.type !== 'payExtort') return
    const choice = pendingExtortFor(state, event.seat)
    if (!choice || choice.triggerId !== event.triggerId) {
      return 'that extort payment is no longer open'
    }
    if (event.mana && !payCost(state.players[event.seat].mana, `{${event.mana}}`)) {
      return `${event.seat} cannot pay {${event.mana}} for extort`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') {
      const spell = state.objects[event.objectId]
      if (!spell) return
      for (const source of draft.zoneOf('battlefield', event.seat)) {
        if (!isExtortSource(source)) continue
        draft.addTriggeredAbility(source, [], {
          abilityId: EXTORT_ABILITY,
          name: `${source.name} — Extort`,
          payload: { spellId: spell.id },
        })
      }
      return
    }

    if (event.type === 'resolveTop' && resolvingExtort(state.stack[0])) {
      const item = state.stack[0]
      draft.players[item.controller].data[PENDING_EXTORT] = {
        triggerId: item.id,
        sourceId: item.objectId,
        source: item.name.replace(/ — Extort$/, ''),
        seat: item.controller,
      } satisfies PendingExtort
      draft.note(`${item.controller} may pay {W/B} for extort`)
      return
    }

    if (event.type !== 'payExtort') return
    const choice = pendingExtortFor(state, event.seat)
    if (!choice || choice.triggerId !== event.triggerId) return
    delete draft.players[event.seat].data[PENDING_EXTORT]
    if (!event.mana) {
      draft.note(`${event.seat} declines extort`)
      return
    }
    const paid = payCost(draft.players[event.seat].mana, `{${event.mana}}`)
    if (!paid) return
    draft.players[event.seat].mana = paid
    const opponents = draft.playerOrder.filter(
      (seat) => seat !== event.seat && !draft.players[seat].lost,
    )
    for (const opponent of opponents) {
      draft.enqueue({
        type: 'loseLife',
        seat: opponent,
        amount: 1,
        source: choice.source,
      })
    }
    draft.players[event.seat].life += opponents.length
    draft.note(
      `${event.seat} pays {${event.mana}} for extort, draining ${opponents.length}`,
    )
  },
}
