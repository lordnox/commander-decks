import type { GameEvent, GameState, ReduceResult } from '../../types'
import { freezeDraft, makeDraft } from '../../draft'
import { pendingSelectionFor } from '../../rules/selectCards'
import { pendingOptionSelection } from '../../rules/selectOptions'
import { beginDrawStepInstance } from '../../rules/drawStepHistory'
import { ok } from '../../testHelpers'

type RulesServer = {
  rules: (state: GameState, event: GameEvent) => ReduceResult
}
import {
  amount,
  card,
  compileCardRuleDefinition,
  createDefinitionSnapshot,
  discard,
  draw,
  ifThen,
  mill,
  players,
  ref,
  replaceWith,
  replacement,
  result,
  staticAbility,
  wouldDraw,
} from './v1'

export const ownDrawStep = (state: GameState, seat: 'p1' | 'p2') => {
  const draft = makeDraft(state)
  draft.step = 'draw'
  draft.active = seat
  beginDrawStepInstance(draft, seat)
  return freezeDraft(draft)
}

export const discardThenDrawDefinition = () => createDefinitionSnapshot(compileCardRuleDefinition(card([
  staticAbility(replacement(
    wouldDraw({
      player: players({ relation: 'any' }),
      firstDrawInOwnDrawStep: false,
    }),
    replaceWith(
      discard({ count: amount(1), targets: ref('event.player'), bindResult: 'discard' }),
      ifThen(result('discard', 'discarded'), {
        then: [draw({ count: amount(1), targets: ref('event.player') })],
        otherwise: [mill({ count: amount(1), targets: ref('event.player') })],
      }),
    ),
  )),
])))

export const pickReplacement = (
  server: RulesServer,
  state: GameState,
  label?: string,
) => {
  const offer = pendingOptionSelection(state, 'p1')
  if (!offer) return state
  const option = label
    ? offer.options.find((entry) => entry.label === label)
    : offer.options[0]
  if (!option) throw new Error('replacement option missing')
  return ok(server.rules(state, {
    type: 'selectOption',
    seat: 'p1',
    selectionId: offer.id,
    optionId: option.id,
  }))
}

export const answerDiscard = (
  server: RulesServer,
  state: GameState,
  restore = false,
) => {
  const working = restore ? JSON.parse(JSON.stringify(state)) as GameState : state
  const pending = pendingSelectionFor(working, 'p1')!
  const handId = working.zoneOrder.p1.hand[0]!
  return ok(server.rules(working, {
    type: 'selectCards',
    seat: 'p1',
    selectionId: pending.id,
    kind: 'discard',
    count: 1,
    objectIds: [handId],
  }))
}
