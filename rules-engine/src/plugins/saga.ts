import { enteringObjectId } from '../cardPlugins/permanentEntry'
import { addMinusCounters, addPlusCounters } from '../cardPlugins/effects'
import { loadDefinitionSnapshot } from '../cardPlugins/dsl/compiler'
import { generatedAbilitySnapshot } from '../cardPlugins/dsl/generatedPrograms'
import type { SagaAbilityDefinition } from '../cardPlugins/dsl/schema/v2'
import type Draft from '../draft'
import { captureObject, snapshotObject } from '../objectIdentity'
import { pendingSelectionsFor } from '../rules/selectCards'
import { pendingPlayerSelectionsFor } from '../rules/selectPlayers'
import type { GameEvent, GameObject, GameState, Plugin } from '../types'

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  V: 5,
  X: 10,
  L: 50,
  C: 100,
  D: 500,
  M: 1000,
}

export const romanNumber = (value: string) => {
  let total = 0
  let previous = 0
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const symbol = value[index]
    const current = ROMAN_VALUES[symbol] ?? 0
    total += current < previous ? -current : current
    previous = current
  }
  return total
}

const canonicalSaga = (object: GameObject): SagaAbilityDefinition | undefined => {
  if (!object.ruleDefinition) return
  try {
    return loadDefinitionSnapshot(object.ruleDefinition).definition.abilities.find(
      (ability): ability is SagaAbilityDefinition => ability.kind === 'saga',
    )
  } catch {
    return
  }
}

const isSaga = (object: GameObject) => object.subtypes.includes('Saga')

const hasReadAhead = (object: GameObject) =>
  canonicalSaga(object)?.readAhead === true

const finalChapter = (object: GameObject) => {
  const canonical = canonicalSaga(object)
  return Math.max(0, ...(canonical?.chapters.flatMap((chapter) => chapter.numbers) ?? []))
}

const queueCanonicalChapter = (
  draft: Draft,
  source: GameObject,
  chapter: SagaAbilityDefinition['chapters'][number],
  number: number,
) => {
  const snapshot = generatedAbilitySnapshot({
    kind: 'triggered',
    on: { kind: 'draw', filter: {} },
    decisions: chapter.decisions ?? { targets: [] },
    instructions: chapter.instructions,
  })
  draft.pendingTriggers = [...(draft.pendingTriggers ?? []), {
    id: draft.allocId('trigger'),
    source: snapshotObject(source),
    instructions: [],
    effect: { do: [] },
    canonical: { definitionSnapshot: snapshot, abilityIndex: 0 },
    execution: {
      controller: source.controller,
      source: captureObject(source, 'current'),
      sagaChapter: number,
    },
    triggeringPlayer: source.controller,
    payload: { sagaChapter: number },
  }]
}

const addChapterTriggers = (
  draft: Draft,
  source: GameObject,
  before: number,
  after: number,
) => {
  const readAheadThisTurn = hasReadAhead(source)
    && source.enteredBattlefieldTurn === draft.turn
  const canonical = canonicalSaga(source)
  if (!canonical) return
  for (const chapter of canonical.chapters) {
    for (const number of chapter.numbers) {
      if (before >= number || after < number) continue
      if (readAheadThisTurn && after !== number) continue
      queueCanonicalChapter(draft, source, chapter, number)
    }
  }
}

const putLoreCounters = (draft: Draft, source: GameObject, count: number) => {
  const before = source.counters.lore ?? 0
  const after = before + count
  source.counters.lore = after
  addChapterTriggers(draft, source, before, after)
  draft.note(`${source.name} gets ${count} lore counter${count === 1 ? '' : 's'}`)
}

const startingChapter = (state: GameState, event: GameEvent) => {
  if (event.type === 'castSpell' || event.type === 'move') return event.sagaChapter
  if (event.type === 'resolveTop') return state.stack[0]?.sagaChapter
  return undefined
}

const enteringSaga = (state: GameState, event: GameEvent, draft: Draft) => {
  if (event.type === 'resolveTop' && state.stack[0]?.kind !== 'spell') return
  const objectId = enteringObjectId(event, state)
  if (!objectId) return
  const source = draft.object(objectId)
  if (!source || source.zone !== 'battlefield' || !isSaga(source)) return
  if (finalChapter(source) === 0) return

  source.enteredBattlefieldTurn = draft.turn
  const lore = hasReadAhead(source) ? startingChapter(state, event) ?? 1 : 1
  source.counters.lore = lore
  addChapterTriggers(draft, source, 0, lore)
  draft.note(`${source.name} enters with ${lore} lore counter${lore === 1 ? '' : 's'}`)
}

const addTurnLore = (state: GameState, event: GameEvent, draft: Draft) => {
  // CR 505.4 / 714.3c: this is a precombat-main turn-based action.
  if (
    event.type !== 'custom'
    || event.name !== 'advanceStep'
    || state.step === 'precombatMain'
    || draft.step !== 'precombatMain'
  ) return

  // Lore follows control, not ownership, so a stolen Saga advances on its
  // controller's turn.
  for (const source of draft.zoneOf('battlefield', draft.active)) {
    if (!isSaga(source) || finalChapter(source) === 0) continue
    putLoreCounters(draft, source, 1)
  }
}

/** A chapter ability is pending while it is on the stack or still choosing its target. */
const chapterPending = (state: GameState, objectId: string) =>
  state.stack.some((item) =>
    item.kind === 'ability'
    && item.objectId === objectId
    && (typeof item.payload?.sagaChapter === 'number' || typeof item.execution?.sagaChapter === 'number'))
  || (state.pendingTriggers ?? []).some((trigger) =>
    trigger.source.id === objectId
    && (typeof trigger.payload?.sagaChapter === 'number' || typeof trigger.execution.sagaChapter === 'number'))
  || state.playerOrder.some((seat) =>
    pendingSelectionsFor(state, seat).some((selection) =>
      selection.sourceId === objectId
      && (
        typeof selection.triggerPayload?.sagaChapter === 'number'
        || typeof selection.canonicalTrigger?.execution.sagaChapter === 'number'
      ))
    || pendingPlayerSelectionsFor(state, seat).some((selection) =>
      selection.sourceId === objectId
      && (
        (
          selection.action.kind === 'putTriggeredAbility'
          && typeof selection.action.payload?.sagaChapter === 'number'
        )
        || (
          selection.action.kind === 'putCanonicalTriggeredAbility'
          && typeof selection.action.execution?.sagaChapter === 'number'
        )
      )))

export const saga: Plugin = {
  id: 'saga',
  legal: ({ state, event }) => {
    if (event.type === 'putCounters') {
      if (!state.objects[event.objectId]) return 'counter recipient does not exist'
      if (!Number.isSafeInteger(event.count) || event.count < 1) {
        return 'counter count must be a positive integer'
      }
      if (!event.counter) return 'counter name must not be empty'
      return
    }

    if (event.type !== 'castSpell' && event.type !== 'move') return
    if (event.sagaChapter === undefined) return
    const object = state.objects[event.objectId]
    if (!object || !isSaga(object) || !hasReadAhead(object)) {
      return 'only a Saga with read ahead can choose a starting chapter'
    }
    const last = finalChapter(object)
    if (
      !Number.isSafeInteger(event.sagaChapter)
      || event.sagaChapter < 1
      || event.sagaChapter > last
    ) {
      return `starting chapter must be between 1 and ${last}`
    }
  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'putCounters') {
      const object = draft.object(event.objectId)
      if (!object) return
      if (event.counter === 'lore' && object.zone === 'battlefield' && isSaga(object)) {
        putLoreCounters(draft, object, event.count)
      } else if (event.counter === '+1/+1') {
        addPlusCounters(object, event.count)
      } else if (event.counter === '-1/-1') {
        addMinusCounters(object, event.count)
      } else {
        object.counters[event.counter] = (object.counters[event.counter] ?? 0) + event.count
      }
      return
    }

    enteringSaga(state, event, draft)
    addTurnLore(state, event, draft)
  },
  sba: ({ state }) => {
    // CR 714.4: a final Saga waits while any of its chapter abilities is pending.
    return Object.values(state.objects).flatMap((source) => {
      if (!isSaga(source) || source.zone !== 'battlefield') return []
      const last = finalChapter(source)
      if (
        last === 0
        || (source.counters.lore ?? 0) < last
        || chapterPending(state, source.id)
      ) return []
      return [{ type: 'sacrifice' as const, objectId: source.id }]
    })
  },
}
