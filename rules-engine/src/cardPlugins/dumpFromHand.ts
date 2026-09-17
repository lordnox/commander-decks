import type { Plugin } from '../types'
import {
  DIALOG_CHOSEN,
  pendingDialogFor,
  pendingDialogsFor,
  setPendingDialog,
} from '../pendingDialog'
import { isPermanentType } from '../definitions'

const REPEAT = 'dumpFromHand.repeat'
const DIRTY = 'dumpFromHand.dirty'

type RepeatSpec = {
  sourceId: string
  source: string
  types?: string[]
  max: number
}

const isRepeat = (value: unknown): value is RepeatSpec =>
  Boolean(value)
  && typeof value === 'object'
  && typeof (value as RepeatSpec).sourceId === 'string'
  && typeof (value as RepeatSpec).source === 'string'

const queueRound = (
  draft: Parameters<NonNullable<Plugin['apply']>>[0]['draft'],
  spec: RepeatSpec,
) => {
  const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  for (const seat of living) {
    setPendingDialog(draft, {
      sourceId: spec.sourceId,
      source: spec.source,
      seat,
      kind: 'put-permanents',
      prompt: spec.types
        ? `You may put up to ${spec.max} ${spec.types.join(', ').toLowerCase()} card(s) from your hand onto the battlefield.`
        : `You may put up to ${spec.max} permanent card(s) from your hand onto the battlefield.`,
      waiting: 'is choosing a card to put onto the battlefield.',
      judge: `Waiting for ${spec.source} dump choices.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: ['hand', 'battlefield'],
      ...(spec.types ? { types: spec.types } : { permanent: true }),
      optional: true,
      sequence: draft.allocTs(),
      requirements: { battlefield: { max: spec.max } },
    })
  }
}

/** Eureka / Hypergenesis keep dumping until a full round puts nothing. */
export const dumpFromHand: Plugin = {
  id: 'dumpFromHand',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    const dialog = pendingDialogFor(state, event.seat)
    if (dialog?.kind !== 'put-permanents') return
    const spec = Object.values(draft.players)
      .map((player) => player.data[REPEAT])
      .find(isRepeat)
    if (!spec || spec.source !== dialog.source) return
    const objectIds = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []
    const put = objectIds.some((objectId) => {
      const object = draft.object(objectId)
      return object
        && object.zone === 'battlefield'
        && (!spec.types || spec.types.some((type) => object.types.includes(type)))
        && (spec.types || isPermanentType(object.types))
    })
    const owner = draft.playerOrder.find((seat) => isRepeat(draft.players[seat].data[REPEAT]))
    if (!owner) return
    if (put) draft.players[owner].data[DIRTY] = true
    const stillOpen = state.playerOrder.some((seat) =>
      pendingDialogsFor(state, seat).some((open) =>
        open.kind === 'put-permanents'
        && open.source === spec.source
        && !(seat === event.seat && open === dialog)))
    if (stillOpen) return
    if (draft.players[owner].data[DIRTY] === true) {
      delete draft.players[owner].data[DIRTY]
      queueRound(draft, spec)
      return
    }
    delete draft.players[owner].data[REPEAT]
    delete draft.players[owner].data[DIRTY]
  },
}
