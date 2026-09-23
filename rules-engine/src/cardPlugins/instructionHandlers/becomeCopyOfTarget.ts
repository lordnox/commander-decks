import { openCardSelection } from '../../rules/selectCards'
import { validTarget } from '../targetedResolve'
import type { InstructionHandler } from './types'
import { PENDING_BECOME_COPY } from '../becomeCopyOfTarget'

const becomeCopyOfTarget: InstructionHandler<'becomeCopyOfTarget'> = (
  { draft, source },
  instruction,
) => {
  const candidates = Object.values(draft.objects)
    .filter((object) =>
      object.zone === 'battlefield'
      && object.id !== source.id
      && validTarget(draft, object, instruction.filter, source.controller))
    .map((object) => object.id)
  if (candidates.length === 0) {
    draft.note(`${source.name} has no legal permanent to copy`)
    return
  }
  draft.players[source.controller].data[PENDING_BECOME_COPY] = {
    sourceId: source.id,
    keepAbility: instruction.keepAbility ?? true,
    filter: instruction.filter,
  }
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 1,
    candidates,
    sourceId: source.id,
    source: source.name,
    prompt: 'Choose a permanent to become a copy of.',
    destinations: ['target'],
  })
}

export const becomeCopyOfTargetHandlers = {
  becomeCopyOfTarget,
}
