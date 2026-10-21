import { openCardSelection } from '../rules/selectCards'
import type { GameObject, PlayerId, Plugin, StackItem } from '../types'
import { targetObject } from '../objectIdentity'

const SPELLS_CAST = 'blinkValue.spellsCast'
const VANISH_RETURNS = 'blinkValue.vanishReturns'
const VANISH_COMPLETIONS = 'blinkValue.vanishCompletions'

type VanishReturn = {
  objectId: string
  sourceId: string
  seat: PlayerId
  toughness: number
  afterTurn: number
}

const targetObjects = (item: StackItem) =>
  item.targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : [])

const validBlinkTarget = (source: string, object: GameObject | undefined, controller: PlayerId) => {
  if (!object || object.zone !== 'battlefield') return false
  if (source === 'Ephemerate') {
    return object.controller === controller && object.types.includes('Creature')
  }
  if (source === 'Ghostly Flicker') {
    return object.controller === controller
      && ['Artifact', 'Creature', 'Land'].some((type) => object.types.includes(type))
  }
  return source === 'Vanish into Memory' && object.types.includes('Creature')
}

const legalBlinkSpell: Plugin['legal'] = ({ state, event }) => {
  if (event.type !== 'castSpell') return
  const source = state.objects[event.objectId]
  if (source?.ruleDefinition) return
  if (!source || !['Ephemerate', 'Ghostly Flicker', 'Vanish into Memory'].includes(source.name)) {
    return
  }
  const targets = event.targets ?? []
  const required = source.name === 'Ghostly Flicker' ? [2, 2] : [1, 1]
  if (targets.length < required[0] || targets.length > required[1]) {
    return `${source.name} needs ${required[0] === required[1] ? required[0] : 'up to 2'} target(s)`
  }
  const ids = targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : [])
  if (ids.length !== targets.length || new Set(ids).size !== ids.length) {
    return `${source.name} needs distinct object targets`
  }
  if (ids.some((id) => !validBlinkTarget(source.name, state.objects[id], event.seat))) {
    return `illegal target for ${source.name}`
  }
}

const blinkNow = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  item: StackItem,
) => {
  const source = draft.object(item.objectId)
  if (!source) return
  const targets = targetObjects(item)
    .map((id) => draft.object(id))
    .filter((object): object is GameObject =>
      validBlinkTarget(source.name, object, item.controller))
  if (source.name === 'Vanish into Memory') {
    const target = targets[0]
    if (!target) return
    const power = Math.max(0, target.power ?? 0)
    const toughness = Math.max(0, target.toughness ?? 0)
    draft.enqueue({ type: 'move', objectId: target.id, to: 'exile' })
    if (power > 0) draft.enqueue({ type: 'draw', seat: item.controller, count: power })
    const returns = (draft.players[item.controller].data[VANISH_RETURNS] as VanishReturn[] | undefined)
      ?? []
    draft.players[item.controller].data[VANISH_RETURNS] = [
      ...returns,
      {
        objectId: target.id,
        sourceId: source.id,
        seat: item.controller,
        toughness,
        afterTurn: draft.turn,
      },
    ]
    return
  }
  for (const target of targets) {
    draft.enqueue({ type: 'move', objectId: target.id, to: 'exile' })
  }
  for (const target of targets) {
    draft.enqueue({
      type: 'move',
      objectId: target.id,
      to: 'battlefield',
      controller: source.name === 'Ghostly Flicker' ? item.controller : target.owner,
    })
  }
}

const trackLotho = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  seat: PlayerId,
) => {
  const previous = draft.players[seat].data[SPELLS_CAST] as
    | { turn: number; count: number }
    | undefined
  const count = previous?.turn === draft.turn ? previous.count + 1 : 1
  draft.players[seat].data[SPELLS_CAST] = { turn: draft.turn, count }
  if (count !== 2) return
  for (const lotho of draft.zoneOf('battlefield').filter(
    (object) => object.name === 'Lotho, Corrupt Shirriff',
  )) {
    draft.addTriggeredAbility(lotho, [
      { kind: 'loseLife', amount: 1, who: 'controller' },
      {
        kind: 'createToken',
        token: {
          name: 'Treasure',
          types: ['Artifact'],
          subtypes: ['Treasure'],
          power: null,
          toughness: null,
          oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
        },
      },
    ])
  }
}

const queueVanishReturns = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
) => {
  if (draft.step !== 'upkeep') return
  const seat = draft.active
  const returns = (draft.players[seat].data[VANISH_RETURNS] as VanishReturn[] | undefined) ?? []
  const due = returns.filter((entry) => entry.afterTurn < draft.turn)
  if (due.length === 0) return
  draft.players[seat].data[VANISH_RETURNS] = returns.filter(
    (entry) => entry.afterTurn >= draft.turn,
  )
  for (const entry of due) {
    const source = draft.object(entry.sourceId)
    if (!source) continue
    draft.addTriggeredAbility(source, [], {
      abilityId: 'vanish.return',
      targets: [{ kind: 'object', objectId: entry.objectId }],
      payload: { discardCount: entry.toughness, returnSeat: entry.seat },
    })
  }
}

export const blinkValue: Plugin = {
  id: 'blinkValue',
  legal: (ctx) => {
    const spellError = legalBlinkSpell(ctx)
    if (spellError) return spellError
    const { state, event } = ctx
    if (event.type === 'completeDelayedReturn') {
      const pending = state.players[event.seat]?.data[VANISH_COMPLETIONS]
      if (
        !Array.isArray(pending)
        || !pending.some((objectId) => objectId === event.objectId)
      ) {
        return 'that delayed return is not pending'
      }
      return
    }

  },
  apply: ({ state, event, draft }) => {
    if (event.type === 'castSpell') trackLotho(draft, event.seat)
    if (event.type === 'resolveTop') {
      const item = state.stack[0]
      if (!item) return
      if (item.kind === 'spell'
        && ['Ephemerate', 'Ghostly Flicker', 'Vanish into Memory'].includes(item.name)) {
        blinkNow(draft, item)
      }
      if (item.kind === 'ability' && item.abilityId === 'vanish.return') {
        const target = item.targets[0]
        const object = target?.kind === 'object' ? targetObject(state, target) : undefined
        const seat = item.payload?.returnSeat
        const discardCount = item.payload?.discardCount
        if (
          object?.zone === 'exile'
          && typeof seat === 'string'
          && typeof discardCount === 'number'
        ) {
          const completions = draft.players[seat].data[VANISH_COMPLETIONS]
          draft.players[seat].data[VANISH_COMPLETIONS] = [
            ...(Array.isArray(completions) ? completions : []),
            object.id,
          ]
          draft.enqueue({
            type: 'move',
            objectId: object.id,
            to: 'battlefield',
            controller: object.owner,
          })
          draft.enqueue({
            type: 'completeDelayedReturn',
            objectId: object.id,
            seat,
            sourceId: item.objectId,
            discardCount,
          })
        }
      }
    }

    if (event.type === 'completeDelayedReturn') {
      const completions = draft.players[event.seat].data[VANISH_COMPLETIONS]
      const remaining = Array.isArray(completions)
        ? completions.filter((objectId) => objectId !== event.objectId)
        : []
      if (remaining.length > 0) {
        draft.players[event.seat].data[VANISH_COMPLETIONS] = remaining
      } else {
        delete draft.players[event.seat].data[VANISH_COMPLETIONS]
      }
      const object = draft.object(event.objectId)
      if (object?.zone !== 'battlefield') return
      const hand = draft.zoneOrder[event.seat].hand
      if (event.discardCount > 0 && hand.length > 0) {
        openCardSelection(draft, {
          seat: event.seat,
          kind: 'discard',
          count: event.discardCount,
          candidates: [...hand],
          sourceId: event.sourceId,
          source: 'Vanish into Memory',
          prompt: `Discard ${Math.min(event.discardCount, hand.length)} card(s).`,
        })
      }
    }

    if (
      event.type === 'custom'
      && event.name === 'advanceStep'
      && draft.step === 'upkeep'
    ) {
      queueVanishReturns(draft)
    }
  },
}
