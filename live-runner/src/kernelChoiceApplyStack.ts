import {
  KEEP_STACK_TARGETS,
  stackCopyPending,
  stackCopyTargetCandidates,
} from '../../rules-engine/src/cardPlugins/stackCopy'
import { objectIdsForNames, type ChoiceContext } from './kernelChoice'
import { closeKernelChoice } from './kernelSettle'

export const applyStackCopy = ({ kernel, lobby, seat, message, state }: ChoiceContext) => {
  const pending = stackCopyPending(state)
  if (!pending || pending.seat !== seat) {
    throw new Error('That stack-copy choice is no longer open.')
  }
  const selected = message.choices.filter(({ destination }) => destination === 'target')
  if (selected.length > 1) throw new Error('Choose at most one target.')
  const item = state.stack.find((candidate) => candidate.id === pending.stackId)
  if (!item) throw new Error('The ability to copy is no longer on the stack.')
  const keepTargets = selected[0]?.card === KEEP_STACK_TARGETS
  const accept = selected.length === 1
  const targets = item.targets.length === 0
    ? undefined
    : selected.length === 1 && !keepTargets
      ? item.targets[0]?.kind === 'player'
        ? [{ kind: 'player' as const, player: selected[0].card }]
        : [{
            kind: 'object' as const,
            objectId: objectIdsForNames(
              state,
              stackCopyTargetCandidates(state, pending).map((object) => object.id),
              [selected[0].card],
            )[0],
          }]
      : undefined
  const result = kernel.dispatch({
    type: 'copyStackItem',
    seat,
    sourceId: pending.sourceId,
    stackId: pending.stackId,
    accept,
    ...(targets ? { targets } : {}),
  })
  if (!result.ok) throw new Error(result.error)
  return closeKernelChoice(kernel, lobby, seat, {
    judge: accept
      ? `${pending.source} copied ${item.name}.`
      : `${pending.source} declined to copy ${item.name}.`,
  })
}
