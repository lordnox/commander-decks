import { emptyMana, nextPlayer, type Draft } from '../draft'
import type { HookCtx, PlayerId, Plugin, StepId } from '../types'

export const STEPS: StepId[] = [
  'untap',
  'upkeep',
  'draw',
  'precombatMain',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
  'endCombat',
  'postcombatMain',
  'end',
  'cleanup',
]

export const nextLivingPlayer = (draft: Draft, from: PlayerId) => {
  let player = nextPlayer(draft, from)
  for (let i = 0; i < draft.playerOrder.length; i += 1) {
    if (!draft.players[player].lost) return player
    player = nextPlayer(draft, player)
  }
  return nextPlayer(draft, from)
}

export const emptyAllManaPools = (draft: Draft) => {
  for (const player of draft.playerOrder) draft.players[player].mana = emptyMana()
}

const onUntap = (draft: Draft) => {
  for (const object of draft.zoneOf('battlefield', draft.active)) {
    object.tapped = false
    object.summoningSickness = false
  }
  draft.players[draft.active].landsPlayed = 0
  draft.note(`${draft.active} untaps`)
}

const onDraw = (draft: Draft) => {
  draft.enqueue({ type: 'draw', seat: draft.active, count: 1 })
}

const onCleanup = (draft: Draft) => {
  for (const object of draft.zoneOf('battlefield')) {
    object.damageMarked = 0
    object.attacking = null
    object.blocking = null
  }
  draft.note('cleanup')
}

const enterStep = (draft: Draft, step: StepId) => {
  if (step === 'untap') return onUntap(draft)
  if (step === 'draw') return onDraw(draft)
  if (step === 'cleanup') return onCleanup(draft)
}

/**
 * Move to the next step, wrapping cleanup into the next player's untap.
 * Every player-turn bumps `turn`. Exported so `priority` can advance when all
 * living players pass on an empty stack; `turnStructure` never imports back.
 */
export const advanceTurnStep = (draft: Draft) => {
  const index = STEPS.indexOf(draft.step)
  const wraps = index === STEPS.length - 1
  const step = STEPS[(index + 1) % STEPS.length]
  draft.step = step
  if (wraps) {
    draft.active = nextLivingPlayer(draft, draft.active)
    draft.turn += 1
  }
  enterStep(draft, step)
  draft.passedInRow = []
  draft.priority = draft.active
  draft.note(`step ${step} (turn ${draft.turn}, active ${draft.active})`)
}

const isAdvance = (event: HookCtx['event']) =>
  event.type === 'advanceStep' || (event.type === 'custom' && event.name === 'advanceStep')

const legal = ({ state, event }: HookCtx) => {
  if (!isAdvance(event)) return
  if (state.stack.length > 0) return 'cannot advance the step while the stack is not empty'
}

const replace = ({ event }: HookCtx) => {
  if (event.type !== 'advanceStep') return
  return [{ type: 'emptyManaPools' as const }, { type: 'custom' as const, name: 'advanceStep' }]
}

const apply = ({ event, draft }: HookCtx) => {
  if (isAdvance(event)) {
    advanceTurnStep(draft)
    return
  }
  if (event.type === 'emptyManaPools') emptyAllManaPools(draft)
}

export const turnStructure: Plugin = { id: 'turnStructure', legal, replace, apply }
