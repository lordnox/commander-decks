import type Draft from '../draft'
import { RANDOM_CHOICE } from '../plugins/hiddenInformation'
import type { GameObject, PlayerId, Plugin } from '../types'
import {
  enteringObjectId,
  PERMANENT_ENTERED,
} from './entersTapped'
import { createToken } from './landfall'

export const SIN_NAME = "Sin, Spira's Punishment"
export const SIN_RANDOM_CARD = 'sin.randomCard'
export const SIN_CARD_CHOSEN = 'sin.cardChosen'
export const SIN_COPY_CARD = 'sin.copyCard'
export const SIN_RESOLVE = 'sin.resolve'
export const SIN_STACK_NAME = `${SIN_NAME} — Enter or attack`

const PERMANENT_TYPES = new Set([
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Land',
  'Planeswalker',
])

const permanentCards = (draft: Draft, controller: PlayerId) =>
  Object.values(draft.objects).filter((object) =>
    object.owner === controller
    && object.zone === 'graveyard'
    && object.types.some((type) => PERMANENT_TYPES.has(type)))

const queueRandomCard = (
  draft: Draft,
  controller: PlayerId,
  sourceId: string,
  enteredIds: string[] = [],
) => {
  const choices = permanentCards(draft, controller).map((object) => object.id)
  if (choices.length === 0) {
    draft.note(`${SIN_NAME} finds no permanent card in ${controller}'s graveyard`)
    for (const objectId of enteredIds) {
      draft.enqueue({
        type: 'custom',
        name: PERMANENT_ENTERED,
        seat: controller,
        payload: { objectId },
      })
    }
    return
  }
  draft.enqueue({
    type: 'custom',
    name: RANDOM_CHOICE,
    seat: controller,
    payload: {
      choices,
      resultName: SIN_CARD_CHOSEN,
      context: { sourceId, enteredIds },
    },
  })
}

const copyTemplate = (card: GameObject): Partial<GameObject> & { name: string } => ({
  name: card.name,
  tapped: true,
  summoningSickness: card.types.includes('Creature'),
  counters: {},
  types: [...card.types],
  subtypes: [...card.subtypes],
  supertypes: [...card.supertypes],
  manaCost: card.manaCost,
  power: card.power,
  toughness: card.toughness,
  oracleText: card.oracleText,
  grantedRules: [...card.grantedRules],
  tags: [],
  tapProduces: card.tapProduces ? { ...card.tapProduces } : undefined,
})

const payloadString = (
  payload: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = payload?.[key]
  return typeof value === 'string' ? value : undefined
}

const payloadStrings = (
  payload: Record<string, unknown> | undefined,
  key: string,
) => {
  const value = payload?.[key]
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : []
}

const putTriggerOnStack = (draft: Draft, source: GameObject) => {
  draft.stack.unshift({
    id: draft.allocId('stack'),
    kind: 'ability',
    objectId: source.id,
    controller: source.controller,
    name: SIN_STACK_NAME,
    targets: [],
  })
  draft.passedInRow = []
  draft.priority = draft.active
  draft.note(`${SIN_NAME} puts its trigger on the stack`)
}

export const sin: Plugin = {
  id: 'sin',
  replace: ({ state, event }) => {
    const item = state.stack[0]
    if (event.type !== 'resolveTop' || item?.name !== SIN_STACK_NAME) return
    return {
      type: 'custom',
      name: SIN_RESOLVE,
      seat: item.controller,
      payload: { sourceId: item.objectId },
    }
  },
  apply: ({ state, event, draft }) => {
    const enteredId = enteringObjectId(event)
    const resolvedPermanent = event.type === 'resolveTop'
      ? state.stack[0]?.objectId
      : undefined
    const entered = draft.object(enteredId ?? resolvedPermanent ?? '')
    if (entered?.zone === 'battlefield' && entered.name === SIN_NAME) {
      putTriggerOnStack(draft, entered)
    }

    if (event.type === 'declareAttackers') {
      for (const declaration of event.attackers) {
        const attacker = draft.object(declaration.objectId)
        if (attacker?.name !== SIN_NAME) continue
        putTriggerOnStack(draft, attacker)
      }
      return
    }

    if (event.type !== 'custom' || !event.seat) return
    if (event.name === SIN_RESOLVE && state.stack[0]?.name === SIN_STACK_NAME) {
      draft.stack.shift()
      queueRandomCard(
        draft,
        event.seat,
        payloadString(event.payload, 'sourceId') ?? state.stack[0]?.objectId ?? '',
      )
      draft.passedInRow = []
      draft.priority = draft.active
      return
    }
    if (event.name === SIN_CARD_CHOSEN) {
      const selected = payloadString(event.payload, 'selected')
      const sourceId = payloadString(event.payload, 'sourceId')
      const enteredIds = payloadStrings(event.payload, 'enteredIds')
      const card = selected ? draft.object(selected) : undefined
      if (
        !card
        || !sourceId
        || card.owner !== event.seat
        || card.zone !== 'graveyard'
        || !card.types.some((type) => PERMANENT_TYPES.has(type))
      ) {
        return
      }
      draft.enqueue({ type: 'move', objectId: card.id, to: 'exile' })
      draft.enqueue({
        type: 'custom',
        name: SIN_COPY_CARD,
        seat: event.seat,
        payload: { selected: card.id, sourceId, enteredIds },
      })
      return
    }

    if (event.name !== SIN_COPY_CARD) return
    const selected = payloadString(event.payload, 'selected')
    const sourceId = payloadString(event.payload, 'sourceId')
    const enteredIds = payloadStrings(event.payload, 'enteredIds')
    const card = selected ? draft.object(selected) : undefined
    if (!card || !sourceId || card.zone !== 'exile' || card.owner !== event.seat) return
    const token = createToken(draft, event.seat, copyTemplate(card), false)
    draft.note(`${SIN_NAME} creates a tapped token copy of ${card.name}`)
    if (card.types.includes('Land')) {
      queueRandomCard(draft, event.seat, sourceId, [...enteredIds, token.id])
      return
    }
    for (const objectId of [...enteredIds, token.id]) {
      draft.enqueue({
        type: 'custom',
        name: PERMANENT_ENTERED,
        seat: event.seat,
        payload: { objectId },
      })
    }
  },
}
