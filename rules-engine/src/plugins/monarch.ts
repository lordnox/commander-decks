import { captureObject } from '../objectIdentity'
import { becomeMonarch, controllerOf, draw, ref } from '../cardPlugins/dsl/v1'
import { releaseMonarchExilesFor } from '../cardPlugins/monarchExile'
import { releaseOpponentMonarchExile } from '../rules/canonicalLinkedExile'
import { queueSourceLessTrigger } from '../rules/sourceLessTriggers'
import { MONARCH_TRIGGER_NAME, monarchTransferTriggerName } from './monarchConstants'
import type { Plugin } from '../types'

/** CR 725: one designation, source-less inherent triggers, and immediate linked returns. */
export const monarch: Plugin = {
  id: 'monarch',
  legal: ({ state, event }) => {
    if (event.type === 'becomeMonarch' && !state.players[event.seat]) return `no such player ${event.seat}`
  },
  apply: ({ state, event, draft }) => {
    switch (event.type) {
      case 'becomeMonarch': {
        const player = draft.players[event.seat]
        if (!player || player.lost || draft.monarch === event.seat) return
        draft.monarch = event.seat
        draft.monarchRevision = (draft.monarchRevision ?? 0) + 1
        draft.monarchAcquiredAt = { ...draft.monarchAcquiredAt, [event.seat]: draft.monarchRevision }
        draft.note(`${event.seat} becomes the monarch`)
        releaseOpponentMonarchExile(draft, event.seat)
        releaseMonarchExilesFor(draft, event.seat)
        return
      }
      case 'dealDamage': {
        const crown = state.monarch
        if (!crown || event.combat !== true || event.amount <= 0 || event.target.kind !== 'player'
          || event.target.player !== crown || state.players[crown]?.lost) return
        const source = event.sourceSnapshot?.ref.objectId === event.sourceId
          ? event.sourceSnapshot.snapshot : state.objects[event.sourceId]
        if (!source?.types.includes('Creature')) return
        queueSourceLessTrigger(draft, {
          controller: crown,
          name: monarchTransferTriggerName(source.name, source.controller),
          ability: { kind: 'triggered', on: { kind: 'dealtDamage', filter: { combat: true } }, instructions: [becomeMonarch(controllerOf(ref('triggering.source'), { information: 'currentOrLastKnown' }))] },
          occurrence: { kind: 'event', eventType: event.type, player: source.controller, amount: event.amount, source: captureObject(source) },
        })
        return
      }
      case 'custom': {
        const crown = draft.monarch
        if (event.name !== 'advanceStep' || state.step === 'end' || draft.step !== 'end'
          || !crown || crown !== draft.active || draft.players[crown]?.lost) return
        queueSourceLessTrigger(draft, {
          controller: crown,
          name: MONARCH_TRIGGER_NAME.draw,
          ability: { kind: 'triggered', on: { kind: 'stepBegins', step: 'end', player: ref('controller') }, instructions: [draw({ targets: ref('controller'), count: 1 })] },
        })
        return
      }
      case 'concede': {
        if (draft.monarch !== event.seat || !draft.players[event.seat]?.lost) return
        const active = draft.active
        const start = draft.playerOrder.indexOf(active)
        const successor = draft.playerOrder.slice(start).concat(draft.playerOrder.slice(0, start))
          .find(seat => !draft.players[seat].lost)
        if (successor) draft.enqueue({ type: 'becomeMonarch', seat: successor })
        else draft.monarch = null
      }
    }
  },
}
