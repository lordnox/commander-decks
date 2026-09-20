import type { Plugin } from '../types'
import { DIALOG_CHOSEN, pendingDialogFor } from '../pendingDialog'
import { applyCopy, millLibrary } from './effects'
import { effectsOf } from './cardRules'
import { finishedSpellZone } from './alternateCosts'
import { STEAL_CAST_DRAW } from './stealCast'

export const choiceEffects: Plugin = {
  id: 'choiceEffects',
  apply: ({ state, event, draft }) => {
    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) {
      return
    }
    const dialog = pendingDialogFor(state, event.seat)
    if (!dialog) return
    const targetIds = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []
    if (dialog.kind === 'copy-creature') {
      const source = draft.object(dialog.sourceId)
      const copied = targetIds[0] ? draft.object(targetIds[0]) : undefined
      if (source && copied) {
        const copy = effectsOf(source)
          .flatMap((effect) => effect.op === 'trigger' ? effect.do : [])
          .find((instruction) => instruction.kind === 'copyControlledCreature')
        applyCopy(source, copied, {
          notLegendary: copy?.kind === 'copyControlledCreature' && copy.notLegendary,
          plusCounters: copy?.kind === 'copyControlledCreature' ? copy.plusCounters : undefined,
          keepName: copy?.kind === 'copyControlledCreature' && copy.keepName,
        })
      }
    }
    if (dialog.kind === 'may' && event.payload?.accepted === true) {
      millLibrary(draft, event.seat, dialog.count ?? 0)
    }
    if (dialog.kind === 'may-draw' && event.payload?.accepted === true) {
      const stealPending = Object.values(state.players).some((player) => {
        const pending = player.data[STEAL_CAST_DRAW]
        return Boolean(
          pending
          && typeof pending === 'object'
          && (pending as { opponent?: string }).opponent === event.seat,
        )
      })
      if (!stealPending) {
        draft.enqueue({ type: 'draw', seat: event.seat, count: dialog.count ?? 1 })
        draft.note(`${event.seat} draws from ${dialog.source}`)
      }
    }
    if (dialog.kind === 'may-pay-life') {
      const land = draft.object(dialog.sourceId)
      if (event.payload?.accepted === true) {
        draft.enqueue({
          type: 'loseLife',
          seat: event.seat,
          amount: dialog.count ?? 2,
          source: dialog.source,
        })
      } else if (land && land.zone === 'battlefield') {
        land.tapped = true
      }
    }
    if (dialog.kind === 'counter-unless') {
      const amount = draft.players[event.seat].data['counterUnlessPay.amount']
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const targetId = objectIds[0]
      const target = targetId ? draft.object(targetId) : undefined
      const paid = event.payload?.paid === true || event.payload?.accepted === true
      if (!paid && target && target.zone === 'stack') {
        const index = draft.stack.findIndex((candidate) => candidate.objectId === target.id)
        if (index >= 0 && draft.stack[index].uncounterable) {
          draft.note(`${dialog.source} cannot counter ${target.name}`)
          delete draft.players[event.seat].data['counterUnlessPay.amount']
          return
        }
        if (index >= 0) {
          const [countered] = draft.stack.splice(index, 1)
          draft.enqueue({
            type: 'move',
            objectId: target.id,
            to: finishedSpellZone(countered, 'graveyard'),
          })
          draft.note(`${dialog.source} counters ${target.name}${typeof amount === 'number' ? ` unless {${amount}}` : ''}`)
        }
      }
      delete draft.players[event.seat].data['counterUnlessPay.amount']
    }
    if (dialog.kind === 'destroy-permanent' || dialog.kind === 'bounce-permanent') {
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const targetId = objectIds[0]
      const target = targetId ? draft.object(targetId) : undefined
      if (target && target.zone === 'battlefield') {
        draft.enqueue({
          type: 'move',
          objectId: target.id,
          to: dialog.kind === 'bounce-permanent' ? 'hand' : 'graveyard',
        })
        draft.note(
          dialog.kind === 'bounce-permanent'
            ? `${dialog.source} returns ${target.name}`
            : `${dialog.source} destroys ${target.name}`,
        )
      }
    }
    if (dialog.kind === 'counter-spell') {
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const targetId = objectIds[0]
      const target = targetId ? draft.object(targetId) : undefined
      if (target && target.zone === 'stack') {
        const index = draft.stack.findIndex((candidate) => candidate.objectId === target.id)
        if (index >= 0 && draft.stack[index].uncounterable) {
          draft.note(`${dialog.source} cannot counter ${target.name}`)
          return
        }
        if (index >= 0) {
          const [countered] = draft.stack.splice(index, 1)
          draft.enqueue({
            type: 'move',
            objectId: target.id,
            to: finishedSpellZone(countered, 'graveyard'),
          })
          draft.note(`${dialog.source} counters ${target.name}`)
        }
      }
    }
    if (dialog.kind === 'look-top-land') {
      const objectIds = Array.isArray(event.payload?.objectIds)
        ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
        : []
      const topIds = draft.zoneOrder[event.seat].library.slice(0, dialog.count ?? 5)
      const toBattlefield = objectIds.filter((id) => topIds.includes(id)).filter((id) => {
        const object = draft.object(id)
        return object?.types.includes('Land')
      })
      for (const objectId of toBattlefield) {
        draft.enqueue({ type: 'move', objectId, to: 'battlefield' })
        draft.enqueue({ type: 'tap', objectId })
      }
      for (const objectId of topIds) {
        if (toBattlefield.includes(objectId)) continue
        draft.enqueue({ type: 'move', objectId, to: 'library', position: 'bottom' })
      }
    }
  },
}
