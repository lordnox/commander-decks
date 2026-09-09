import { emptyMana, nextSeat, type Draft } from '../draft'
import { SEAT_IDS, type HookCtx, type Plugin, type SeatId, type StepId } from '../types'

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

/** `o2` sorts before `o10`; unknown shapes sink to the bottom of the library. */
const idIndex = (id: string) => {
  const digits = id.match(/\d+/)
  return digits ? Number(digits[0]) : Number.MAX_SAFE_INTEGER
}

export const nextLivingSeat = (draft: Draft, from: SeatId) => {
  let seat = nextSeat(from)
  for (let i = 0; i < SEAT_IDS.length; i += 1) {
    if (!draft.players[seat].lost) return seat
    seat = nextSeat(seat)
  }
  return nextSeat(from)
}

export const emptyAllManaPools = (draft: Draft) => {
  for (const seat of SEAT_IDS) draft.players[seat].mana = emptyMana()
}

const libraryTop = (draft: Draft, seat: SeatId) =>
  Object.values(draft.objects)
    .filter((object) => object.zone === 'library' && object.owner === seat)
    .sort((a, b) => idIndex(a.id) - idIndex(b.id))[0]

const onUntap = (draft: Draft) => {
  for (const object of draft.zoneOf('battlefield', draft.active)) {
    object.tapped = false
    object.summoningSickness = false
  }
  draft.players[draft.active].landsPlayed = 0
  draft.note(`${draft.active} untaps`)
}

const onDraw = (draft: Draft) => {
  const seat = draft.active
  const card = libraryTop(draft, seat)
  if (!card) {
    draft.players[seat].lost = true
    draft.note(`${seat} draws from an empty library`)
    return
  }
  draft.move(card.id, 'hand')
  draft.note(`${seat} draws ${card.name}`)
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
    draft.active = nextLivingSeat(draft, draft.active)
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
