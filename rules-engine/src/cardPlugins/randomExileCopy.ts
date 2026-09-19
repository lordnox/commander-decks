import { isPermanentType } from '../definitions'
import { RANDOM_CHOICE } from '../plugins/hiddenInformation'
import type { Plugin } from '../types'
import { PERMANENT_ENTERED } from './entersTapped'
import {
  copyTokenTemplate,
  createToken,
  graveyardPermanentIds,
  RANDOM_EXILE_COPY_CARD_CHOSEN,
  RANDOM_EXILE_COPY_FINISH,
} from './effects'

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

const payloadBoolean = (
  payload: Record<string, unknown> | undefined,
  key: string,
) => payload?.[key] === true

export const randomExileCopy: Plugin = {
  id: 'randomExileCopy',
  apply: ({ event, draft }) => {
    if (event.type !== 'custom' || !event.seat) return

    if (event.name === RANDOM_EXILE_COPY_CARD_CHOSEN) {
      const selected = payloadString(event.payload, 'selected')
      const sourceId = payloadString(event.payload, 'sourceId')
      const sourceName = payloadString(event.payload, 'sourceName')
      const repeatWhileType = payloadString(event.payload, 'repeatWhileType')
      const selectedIds = payloadStrings(event.payload, 'selectedIds')
      const tapped = payloadBoolean(event.payload, 'tapped')
      const card = selected ? draft.object(selected) : undefined
      if (
        !card
        || !sourceId
        || !sourceName
        || !repeatWhileType
        || selectedIds.includes(card.id)
        || card.owner !== event.seat
        || card.zone !== 'graveyard'
        || !isPermanentType(card.types)
      ) return

      const copies = [...selectedIds, card.id]
      draft.enqueue({ type: 'move', objectId: card.id, to: 'exile' })

      if (card.types.includes(repeatWhileType)) {
        const choices = graveyardPermanentIds(draft, event.seat, copies)
        if (choices.length > 0) {
          draft.enqueue({
            type: 'custom',
            name: RANDOM_CHOICE,
            seat: event.seat,
            payload: {
              choices,
              resultName: RANDOM_EXILE_COPY_CARD_CHOSEN,
              context: {
                sourceId,
                sourceName,
                repeatWhileType,
                tapped,
                selectedIds: copies,
              },
            },
          })
          return
        }
      }

      draft.enqueue({
        type: 'custom',
        name: RANDOM_EXILE_COPY_FINISH,
        seat: event.seat,
        payload: { sourceName, selectedIds: copies, tapped },
      })
      return
    }

    if (event.name !== RANDOM_EXILE_COPY_FINISH) return
    const sourceName = payloadString(event.payload, 'sourceName')
    const selectedIds = payloadStrings(event.payload, 'selectedIds')
    const tapped = payloadBoolean(event.payload, 'tapped')
    const enteredIds: string[] = []
    for (const objectId of selectedIds) {
      const card = draft.object(objectId)
      if (!card || card.owner !== event.seat || card.zone !== 'exile') continue
      const token = createToken(
        draft,
        event.seat,
        copyTokenTemplate(card, { tapped }),
        false,
      )
      enteredIds.push(token.id)
      draft.note(`${sourceName ?? 'The ability'} creates a token copy of ${card.name}`)
    }
    for (const objectId of enteredIds) {
      draft.enqueue({
        type: 'custom',
        name: PERMANENT_ENTERED,
        seat: event.seat,
        payload: { objectId },
      })
    }
  },
}
