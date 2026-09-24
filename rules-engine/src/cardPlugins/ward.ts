import {
  clearPendingDialog,
  DIALOG_CHOSEN,
  pendingDialogFor,
  setPendingDialog,
} from '../pendingDialog'
import { wardGeneric } from '../keywords'
import { openCardSelection } from '../rules/selectCards'
import type { GameEvent, GameObject, GameState, Plugin, TargetRef } from '../types'
import { effectsOf } from './cardRules'
import { finishedSpellZone } from './alternateCosts'
import type { CardEffect } from './effects'

export const WARD_PENDING_CAST = 'ward.pendingCast'
export const WARD_AWAITING = 'ward.awaitingSacrifice'

type WardSpec = NonNullable<Extract<CardEffect, { op: 'static' }>['ward']>

type PendingCast = {
  event: Extract<GameEvent, { type: 'castSpell' | 'activateAbility' }>
}

const wardEffect = (object: GameObject): WardSpec | undefined => {
  const stamped = effectsOf(object).flatMap((effect) =>
    effect.op === 'static' && effect.ward ? [effect.ward] : [])[0]
  if (stamped) {
    if (stamped.generic !== undefined && stamped.mana === undefined) {
      return { ...stamped, mana: stamped.generic }
    }
    return stamped
  }
  const generic = wardGeneric(object)
  if (generic !== undefined) return { mana: generic }
}

const targetedObjectIds = (targets: TargetRef[] | undefined) =>
  (targets ?? []).flatMap((target) =>
    target.kind === 'object' ? [target.objectId] : [])

const wardTargets = (
  state: GameState,
  caster: string,
  targets: TargetRef[] | undefined,
  wardPaid = false,
) => {
  if (wardPaid) return []
  return targetedObjectIds(targets).flatMap((objectId) => {
  const object = state.objects[objectId]
  const ward = object ? wardEffect(object) : undefined
  if (
    !object
    || !ward
    || object.zone !== 'battlefield'
    || object.controller === caster
  ) return []
  return [{ object, ward }]
  })
}

const pendingCastFor = (state: GameState, seat: string): PendingCast | undefined => {
  const pending = state.players[seat]?.data[WARD_PENDING_CAST]
  if (
    pending
    && typeof pending === 'object'
    && (pending as PendingCast).event
    && typeof (pending as PendingCast).event.type === 'string'
  ) {
    return pending as PendingCast
  }
}

const storePendingCast = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  seat: string,
  event: PendingCast['event'],
) => {
  draft.players[seat].data[WARD_PENDING_CAST] = { event } satisfies PendingCast
}

const clearPendingCast = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  seat: string,
) => {
  delete draft.players[seat].data[WARD_PENDING_CAST]
}

const openWardChoice = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  seat: string,
  warded: GameObject,
  ward: WardSpec,
  pending: PendingCast,
) => {
  if (ward.mana !== undefined) {
    setPendingDialog(draft, {
      sourceId: warded.id,
      source: warded.name,
      seat,
      kind: 'ward-pay',
      prompt: `Pay {${ward.mana}} or ${warded.name} is countered.`,
      waiting: 'is paying Ward.',
      judge: `Waiting for Ward {${ward.mana}}.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['skip', 'target'],
      count: ward.mana,
      optional: true,
    })
    storePendingCast(draft, seat, pending.event)
    draft.priority = seat
    return
  }
  if (ward.sacrifice) {
    const candidates = Object.values(draft.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && (!ward.sacrifice?.nonland || !object.types.includes('Land')))
      .map((object) => object.id)
    if (candidates.length < ward.sacrifice.count) {
      draft.note(`${warded.name}'s Ward was not paid`)
      return
    }
    openCardSelection(draft, {
      seat,
      kind: 'sacrifice',
      count: ward.sacrifice.count,
      min: ward.sacrifice.count,
      candidates,
      sourceId: warded.id,
      source: warded.name,
      prompt: `Sacrifice ${ward.sacrifice.count} nonland permanent(s) or ${warded.name} is countered.`,
      destinations: ['sacrifice'],
    })
    draft.players[seat].data[WARD_AWAITING] = true
    storePendingCast(draft, seat, pending.event)
    draft.priority = seat
  }
}

const counterPending = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  pending: PendingCast,
) => {
  if (pending.event.type === 'castSpell') {
    const object = draft.object(pending.event.objectId)
    if (object?.zone === 'stack') {
      const index = draft.stack.findIndex((item) => item.objectId === object.id)
      if (index >= 0) {
        const [countered] = draft.stack.splice(index, 1)
        draft.enqueue({
          type: 'move',
          objectId: object.id,
          to: finishedSpellZone(countered, 'graveyard'),
        })
      }
    }
    draft.note(`${object?.name ?? 'Spell'} was countered by Ward`)
    return
  }
  if (pending.event.type === 'activateAbility') {
    const ability = pending.event
    const index = draft.stack.findIndex((item) =>
      item.kind === 'ability'
      && item.objectId === ability.objectId
      && item.abilityId === ability.abilityId)
    if (index >= 0) draft.stack.splice(index, 1)
    draft.note('Ability was countered by Ward')
  }
}

export const ward: Plugin = {
  id: 'ward',
  legal: ({ state, event }) => {
    const seat = 'seat' in event ? event.seat : undefined
    const pending = seat ? pendingCastFor(state, seat) : undefined
    if (pending && seat) {
      const allowed = event.type === 'custom'
        || event.type === 'selectCards'
        || event.type === 'tapForMana'
        || event.type === 'addMana'
        || event.type === 'authoritativeSync'
        || event.type === 'concede'
      if (!allowed) return `${seat} must pay Ward or let the spell be countered`
    }
    if (event.type !== 'castSpell' && event.type !== 'activateAbility') return
    if (pendingCastFor(state, event.seat)) return `${event.seat} is paying Ward`
    const warded = wardTargets(state, event.seat, event.targets, event.wardPaid)
    if (warded.length === 0) return
  },
  replace: ({ state, event }) => {
    if (event.type !== 'castSpell' && event.type !== 'activateAbility') return
    if (pendingCastFor(state, event.seat)) return null
    const warded = wardTargets(state, event.seat, event.targets, event.wardPaid)
    if (warded.length === 0) return
    return {
      type: 'custom',
      name: 'ward.begin',
      seat: event.seat,
      payload: { cast: event },
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'custom' && event.name === 'ward.begin' && event.seat) {
      const cast = event.payload?.cast as PendingCast['event'] | undefined
      if (!cast || (cast.type !== 'castSpell' && cast.type !== 'activateAbility')) return
      const warded = wardTargets(state, event.seat, cast.targets, cast.wardPaid)
      const first = warded[0]
      if (!first) return
      openWardChoice(draft, event.seat, first.object, first.ward, { event: cast })
      return
    }

    if (event.type === 'custom' && event.name === DIALOG_CHOSEN && event.seat) {
      const dialog = pendingDialogFor(state, event.seat)
      if (dialog?.kind !== 'ward-pay') return
      const pending = pendingCastFor(state, event.seat)
      clearPendingDialog(draft, event.seat)
      if (!pending) return
      const paid = event.payload?.accepted === true || event.payload?.paid === true
      if (paid && typeof dialog.count === 'number' && dialog.count > 0) {
        draft.enqueue({
          type: 'payMana',
          seat: event.seat,
          cost: `{${dialog.count}}`,
        })
        clearPendingCast(draft, event.seat)
        draft.enqueue({ ...pending.event, wardPaid: true })
        draft.note(`${event.seat} pays Ward {${dialog.count}}`)
        return
      }
      clearPendingCast(draft, event.seat)
      counterPending(draft, pending)
      return
    }

    if (event.type === 'selectCards' && event.seat && event.kind === 'sacrifice') {
      if (!state.players[event.seat]?.data[WARD_AWAITING]) return
      const pending = pendingCastFor(state, event.seat)
      delete draft.players[event.seat].data[WARD_AWAITING]
      if (!pending) return
      const count = event.objectIds?.length ?? 0
      const required = wardTargets(state, event.seat, pending.event.targets)[0]?.ward.sacrifice?.count ?? 0
      clearPendingCast(draft, event.seat)
      if (count < required) {
        counterPending(draft, pending)
        return
      }
      draft.enqueue({ ...pending.event, wardPaid: true })
      draft.note(`${event.seat} pays Ward`)
    }
  },
}
