import type Draft from '../draft'
import { DIALOG_CHOSEN, pendingDialogFor, setPendingDialog } from '../pendingDialog'
import type { PlayerId, Plugin } from '../types'

export const RANKLE_MODES = {
  discard: 'Each player discards a card',
  drain: 'Each player loses 1 life and draws a card',
  sacrifice: 'Each player sacrifices a creature',
} as const

/** Printed order, which is also the order the chosen modes happen in. */
const MODE_ORDER = [
  RANKLE_MODES.discard,
  RANKLE_MODES.drain,
  RANKLE_MODES.sacrifice,
] as const

/** Turn order starting with the active player, so choices follow APNAP. */
const apnap = (draft: Draft): PlayerId[] => {
  const order = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
  const start = order.indexOf(draft.active)
  return start < 0 ? order : [...order.slice(start), ...order.slice(0, start)]
}

const askEachPlayer = (
  draft: Draft,
  sourceId: string,
  source: string,
  kind: 'discard-card' | 'sacrifice-creature',
) => {
  for (const seat of apnap(draft)) {
    const hasChoice = kind === 'discard-card'
      ? draft.zoneOrder[seat].hand.length > 0
      : Object.values(draft.objects).some((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes('Creature'))
    if (!hasChoice) continue
    setPendingDialog(draft, {
      sourceId,
      source,
      seat,
      kind,
      prompt: kind === 'discard-card'
        ? `${source} makes each player discard a card. Choose one.`
        : `${source} makes each player sacrifice a creature. Choose one.`,
      waiting: kind === 'discard-card'
        ? 'is choosing a card to discard.'
        : 'is choosing a creature to sacrifice.',
      judge: `${source}: ${
        kind === 'discard-card' ? 'each player discards' : 'each player sacrifices a creature'
      }.`,
      chosenEvent: DIALOG_CHOSEN,
      destinations: kind === 'discard-card'
        ? ['hand', 'graveyard']
        : ['battlefield', 'sacrifice'],
      requirements: kind === 'discard-card'
        ? { graveyard: { min: 1, max: 1 } }
        : { sacrifice: { min: 1, max: 1 } },
      count: 1,
    })
  }
}

/**
 * Rankle, Master of Pranks: whenever it deals combat damage to a player, its
 * controller chooses any number of the three modes, and every player — Rankle's
 * controller included — pays each chosen one (CR 700.2d). The modes happen in
 * printed order, and each player picks their own card and creature.
 */
export const rankle: Plugin = {
  id: 'rankle',
  apply: ({ state, event, draft, rule }) => {
    if (event.type === 'combatDamage' && event.target.kind === 'player') {
      const source = draft.objects[rule.sourceId ?? '']
      if (!source || event.sourceId !== source.id) return
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'choose-modes',
        options: [...MODE_ORDER],
        prompt: `${source.name} connected. Choose any number of its modes.`,
        waiting: 'is choosing Rankle modes.',
        judge: `${source.name} dealt combat damage; its controller is choosing modes.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
      })
      return
    }

    if (event.type !== 'custom' || event.name !== DIALOG_CHOSEN || !event.seat) return
    // The dialog lock has already answered the oldest choice on this draft, so
    // the question being answered is read from the state before the event.
    const dialog = pendingDialogFor(state, event.seat)
    if (!dialog || dialog.sourceId !== rule.sourceId) return

    if (dialog.kind === 'choose-modes') {
      const chosen = Array.isArray(event.payload?.modes)
        ? event.payload.modes.filter((mode): mode is string => typeof mode === 'string')
        : []
      const modes = MODE_ORDER.filter((mode) => chosen.includes(mode))
      draft.note(
        modes.length > 0
          ? `${dialog.source}: ${modes.join('; ')}`
          : `${dialog.source} chooses no modes`,
      )
      for (const mode of modes) {
        if (mode === RANKLE_MODES.discard) {
          askEachPlayer(draft, dialog.sourceId, dialog.source, 'discard-card')
        }
        if (mode === RANKLE_MODES.drain) {
          for (const seat of apnap(draft)) {
            draft.enqueue({ type: 'loseLife', seat, amount: 1, source: dialog.sourceId })
            draft.enqueue({ type: 'draw', seat, count: 1 })
          }
        }
        if (mode === RANKLE_MODES.sacrifice) {
          askEachPlayer(draft, dialog.sourceId, dialog.source, 'sacrifice-creature')
        }
      }
      return
    }

    const chosenIds = Array.isArray(event.payload?.objectIds)
      ? event.payload.objectIds.filter((id): id is string => typeof id === 'string')
      : []

    if (dialog.kind === 'discard-card') {
      const objectId = chosenIds.find((id) => {
        const object = draft.objects[id]
        return object?.zone === 'hand' && object.controller === event.seat
      })
      if (objectId) draft.enqueue({ type: 'discard', seat: event.seat, objectId })
      return
    }

    if (dialog.kind === 'sacrifice-creature') {
      const objectId = chosenIds.find((id) => {
        const object = draft.objects[id]
        return object?.zone === 'battlefield'
          && object.controller === event.seat
          && object.types.includes('Creature')
      })
      if (!objectId) return
      draft.note(`${event.seat} sacrifices ${draft.objects[objectId]?.name} to ${dialog.source}`)
      draft.enqueue({ type: 'move', objectId, to: 'graveyard' })
    }
  },
}
