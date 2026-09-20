import { hasKeyword } from '../keywords'
import { registerDelayedTrigger } from '../rules/delayedTriggers'
import {
  ceaseSpellCopy,
  createSpellCopy,
  putSpellCopyOnStack,
} from '../rules/spellCopies'
import type {
  GameObject,
  GameState,
  PlayerId,
  Plugin,
  TargetRef,
} from '../types'

export const EPIC_LOCK = 'kernel.epicLock'
export const PARADIGM_NAMES = 'kernel.paradigmNames'
export const PENDING_RECURRING_SPELL = 'kernel.pendingRecurringSpell'

type RepeatSpell = {
  mode: 'epic' | 'paradigm'
  spell: GameObject
  targets: TargetRef[]
}

type PendingParadigm = {
  mode: 'paradigm'
  seat: PlayerId
  copyId: string
  name: string
}

type PendingEpic = {
  mode: 'epic'
  seat: PlayerId
  sourceId: string
  spell: GameObject
  targets: TargetRef[]
}

type PendingRecurringSpell = PendingParadigm | PendingEpic

const paradigmNames = (state: GameState, seat: PlayerId) => {
  const value = state.players[seat]?.data[PARADIGM_NAMES]
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : []
}

const isPending = (value: unknown): value is PendingRecurringSpell =>
  Boolean(value)
  && typeof value === 'object'
  && (
    (value as PendingRecurringSpell).mode === 'epic'
    || (value as PendingRecurringSpell).mode === 'paradigm'
  )
  && typeof (value as PendingRecurringSpell).seat === 'string'

const pendingRecurringSpell = (state: GameState) => {
  for (const seat of state.playerOrder) {
    const value = state.players[seat].data[PENDING_RECURRING_SPELL]
    if (isPending(value) && value.seat === seat) return value
  }
}

const isRepeatSpell = (value: unknown): value is RepeatSpell => {
  if (!value || typeof value !== 'object') return false
  const repeat = value as RepeatSpell
  return (
    (repeat.mode === 'epic' || repeat.mode === 'paradigm')
    && Boolean(repeat.spell)
    && typeof repeat.spell === 'object'
    && typeof repeat.spell.id === 'string'
    && Array.isArray(repeat.targets)
  )
}

const repeatPayload = (
  mode: RepeatSpell['mode'],
  spell: GameObject,
  targets: TargetRef[],
) => ({
  repeatSpell: {
    mode,
    spell: structuredClone(spell),
    targets: structuredClone(targets),
  } satisfies RepeatSpell,
})

const registerParadigm = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  spell: GameObject,
  controller: PlayerId,
  targets: TargetRef[],
) => {
  const names = paradigmNames(draft, controller)
  if (names.includes(spell.name)) return
  draft.players[controller].data[PARADIGM_NAMES] = [...names, spell.name]
  registerDelayedTrigger(
    draft,
    { ...spell, controller },
    { kind: 'step', step: 'precombatMain', active: controller },
    [],
    { recurring: true, payload: repeatPayload('paradigm', spell, targets) },
  )
}

const registerEpic = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  spell: GameObject,
  controller: PlayerId,
  targets: TargetRef[],
) => {
  draft.players[controller].data[EPIC_LOCK] = true
  registerDelayedTrigger(
    draft,
    { ...spell, controller },
    { kind: 'step', step: 'upkeep', active: controller },
    [],
    { recurring: true, payload: repeatPayload('epic', spell, targets) },
  )
}

export const recurringSpells: Plugin = {
  id: 'recurringSpells',
  legal: ({ state, event }) => {
    const pending = pendingRecurringSpell(state)
    if (event.type === 'passPriority' && pending) {
      return `${pending.seat} is resolving ${pending.mode}`
    }
    if (event.type === 'castSpell' && state.players[event.seat].data[EPIC_LOCK] === true) {
      return 'epic prevents that player from casting spells'
    }
    if (event.type === 'chooseParadigm') {
      if (
        pending?.mode !== 'paradigm'
        || pending.seat !== event.seat
        || pending.copyId !== event.copyId
      ) {
        return 'that paradigm copy is not pending'
      }
      if (!event.cast && event.targets?.length) {
        return 'a declined paradigm cast cannot choose targets'
      }
      return
    }
    if (event.type === 'chooseEpicTargets') {
      if (
        pending?.mode !== 'epic'
        || pending.seat !== event.seat
        || pending.sourceId !== event.sourceId
      ) {
        return 'that epic copy is not pending'
      }
      return
    }
    if (event.type !== 'castSpell' || (!event.copy && !event.withoutPayingMana)) return
    if (!event.copy || !event.withoutPayingMana) {
      return 'spell copies cast without paying their mana cost require an effect'
    }
    if (
      pending?.mode !== 'paradigm'
      || pending.seat !== event.seat
      || pending.copyId !== event.objectId
    ) {
      return 'no effect allows that spell copy to be cast'
    }
  },
  replace: ({ state, event }) => {
    if (event.type === 'move' && event.to === 'graveyard') {
      const object = state.objects[event.objectId]
      if (
        object?.zone === 'stack'
        && !object.spellCopy
        && hasKeyword(object, 'paradigm')
      ) {
        return { ...event, to: 'exile' }
      }
      return
    }
    if (event.type !== 'chooseParadigm' || !event.cast) return
    return {
      type: 'castSpell',
      seat: event.seat,
      objectId: event.copyId,
      targets: event.targets,
      copy: true,
      withoutPayingMana: true,
    }
  },
  apply: ({ state, event, draft }) => {
    const pending = pendingRecurringSpell(state)
    if (
      event.type === 'castSpell'
      && pending?.mode === 'paradigm'
      && pending.copyId === event.objectId
    ) {
      delete draft.players[pending.seat].data[PENDING_RECURRING_SPELL]
      return
    }
    if (event.type === 'chooseParadigm' && pending?.mode === 'paradigm') {
      const copy = draft.object(pending.copyId)
      if (copy) ceaseSpellCopy(draft, copy)
      delete draft.players[pending.seat].data[PENDING_RECURRING_SPELL]
      return
    }
    if (event.type === 'chooseEpicTargets' && pending?.mode === 'epic') {
      putSpellCopyOnStack(
        draft,
        pending.spell,
        pending.seat,
        event.targets ?? pending.targets,
        'epic',
      )
      delete draft.players[pending.seat].data[PENDING_RECURRING_SPELL]
      draft.passedInRow = []
      draft.priority = draft.active
      return
    }

    if (event.type === 'resolveRecurringSpell') {
      if (event.mode === 'paradigm') {
        const copy = createSpellCopy(
          draft,
          event.spell,
          event.seat,
          'exile',
        )
        draft.players[event.seat].data[PENDING_RECURRING_SPELL] = {
          mode: 'paradigm',
          seat: event.seat,
          copyId: copy.id,
          name: copy.name,
        } satisfies PendingParadigm
        draft.priority = event.seat
        return
      }
      if (event.targets.length === 0) {
        putSpellCopyOnStack(draft, event.spell, event.seat, [], 'epic')
        return
      }
      draft.players[event.seat].data[PENDING_RECURRING_SPELL] = {
        mode: 'epic',
        seat: event.seat,
        sourceId: event.spell.id,
        spell: event.spell,
        targets: event.targets,
      } satisfies PendingEpic
      draft.priority = event.seat
      return
    }

    if (event.type !== 'resolveTop') return
    const item = state.stack[0]
    if (!item) return
    const repeat = item.payload?.repeatSpell
    if (isRepeatSpell(repeat)) {
      draft.enqueue({
        type: 'resolveRecurringSpell',
        seat: item.controller,
        mode: repeat.mode,
        spell: repeat.spell,
        targets: repeat.targets,
      })
      return
    }

    if (item.kind !== 'spell') return
    const spell = state.objects[item.objectId]
    if (!spell) return
    if (hasKeyword(spell, 'epic')) {
      registerEpic(draft, spell, item.controller, item.targets)
    }
    if (hasKeyword(spell, 'paradigm')) {
      registerParadigm(draft, spell, item.controller, item.targets)
    }
  },
}
