import { hasKeyword } from '../keywords'
import type { GameEvent, GameState, PlayerId, Plugin } from '../types'

export const ACTIVE_PARADIGMS = 'kernel.activeParadigms'
export const PENDING_PARADIGM = 'kernel.pendingParadigm'
export const PARADIGM_TRIGGER = 'paradigm.trigger'

type ActiveParadigm = {
  sourceId: string
  name: string
}

type PendingParadigm = ActiveParadigm & {
  seat: PlayerId
}

const activeParadigms = (state: GameState, seat: PlayerId) => {
  const value = state.players[seat]?.data[ACTIVE_PARADIGMS]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is ActiveParadigm =>
    Boolean(entry)
    && typeof entry === 'object'
    && typeof (entry as ActiveParadigm).sourceId === 'string'
    && typeof (entry as ActiveParadigm).name === 'string')
}

const pendingParadigm = (state: GameState): PendingParadigm | undefined => {
  for (const seat of state.playerOrder) {
    const value = state.players[seat].data[PENDING_PARADIGM]
    if (
      value
      && typeof value === 'object'
      && typeof (value as PendingParadigm).sourceId === 'string'
      && typeof (value as PendingParadigm).name === 'string'
      && (value as PendingParadigm).seat === seat
    ) {
      return value as PendingParadigm
    }
  }
}

const clearPendingEvent = (seat: PlayerId): GameEvent => ({
  type: 'custom',
  name: 'paradigm.clearPending',
  seat,
})

export const paradigm: Plugin = {
  id: 'paradigm',
  legal: ({ state, event }) => {
    const pending = pendingParadigm(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} is deciding whether to cast ${pending.name}`
    }
    if (event.type === 'chooseParadigm') {
      if (!pending) return 'no paradigm cast is pending'
      if (pending.seat !== event.seat || pending.sourceId !== event.sourceId) {
        return 'that paradigm cast is not pending'
      }
      if (!event.cast && event.targets?.length) {
        return 'a declined paradigm cast cannot choose targets'
      }
      return
    }
    if (event.type !== 'castSpell' || (!event.copy && !event.withoutPayingMana)) return
    if (!event.copy || !event.withoutPayingMana) {
      return 'spell copies cast without paying their mana cost require an effect'
    }
    if (
      !pending
      || pending.seat !== event.seat
      || pending.sourceId !== event.objectId
    ) {
      return 'no effect allows that spell copy to be cast'
    }
  },
  replace: ({ event }) => {
    if (event.type !== 'chooseParadigm') return
    if (!event.cast) return clearPendingEvent(event.seat)
    return [
      {
        type: 'castSpell',
        seat: event.seat,
        objectId: event.sourceId,
        targets: event.targets,
        copy: true,
        withoutPayingMana: true,
      },
      clearPendingEvent(event.seat),
    ]
  },
  apply: ({ state, event, draft }) => {
    if (
      event.type === 'custom'
      && event.name === 'paradigm.clearPending'
      && event.seat
    ) {
      delete draft.players[event.seat].data[PENDING_PARADIGM]
      return
    }

    if (
      event.type === 'custom'
      && event.name === 'advanceStep'
      && draft.step === 'precombatMain'
    ) {
      for (const entry of activeParadigms(state, draft.active)) {
        const source = draft.object(entry.sourceId)
        if (!source) continue
        draft.addToStack({
          kind: 'ability',
          objectId: source.id,
          controller: draft.active,
          name: `${entry.name} — Paradigm`,
          targets: [],
          abilityId: PARADIGM_TRIGGER,
        })
      }
      return
    }

    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item) return
    if (item.abilityId === PARADIGM_TRIGGER) {
      const source = state.objects[item.objectId]
      if (!source) return
      draft.players[item.controller].data[PENDING_PARADIGM] = {
        sourceId: source.id,
        name: source.name,
        seat: item.controller,
      } satisfies PendingParadigm
      draft.priority = item.controller
      return
    }
    if (item.kind !== 'spell') return
    const object = state.objects[item.objectId]
    if (!object || !hasKeyword(object, 'paradigm')) return
    const active = activeParadigms(state, item.controller)
    if (active.some((entry) => entry.name === object.name)) return
    draft.players[item.controller].data[ACTIVE_PARADIGMS] = [
      ...active,
      { sourceId: object.id, name: object.name },
    ]
  },
}
