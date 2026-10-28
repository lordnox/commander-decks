import type Draft from '../draft'
import { openCardSelection, targetDestinations } from '../rules/selectCards'
import { linkExileSelected, releaseLinkedExile, type LinkedExileReturn } from '../rules/linkExile'
import { apnapSeats } from '../turnOrder'
import type { GameObject, StackItem } from '../types'
import { validTarget } from './targetedResolve'
import type { TargetFilter } from './effectDefinitions'
import type { InstructionHandler } from './instructionHandlers/types'

export type { LinkedExileReturn }
export { linkExileSelected, releaseLinkedExile }

const stackObjectTargets = (item?: StackItem) =>
  item?.targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : []) ?? []

const matchingCandidates = (
  draft: Draft,
  source: GameObject,
  filter: TargetFilter,
  controlled?: boolean,
  opponent?: string,
) => Object.values(draft.objects)
  .filter((object) => {
    if (object.id === source.id) return false
    if (object.zone !== 'battlefield') return false
    if (controlled && object.controller !== source.controller) return false
    if (opponent && object.controller !== opponent) return false
    return validTarget(draft, object, filter, source.controller)
  })
  .map((object) => object.id)

const openLinkExileChoice = (
  draft: Draft,
  source: GameObject,
  filter: TargetFilter,
  options: {
    count: number
    min: number
    candidates: string[]
    prompt: string
    seat?: string
  },
) => {
  if (options.candidates.length === 0 && options.min > 0) return
  openCardSelection(draft, {
    seat: options.seat ?? source.controller,
    kind: 'choose',
    count: options.count,
    min: options.min,
    candidates: options.candidates,
    sourceId: source.id,
    source: source.name,
    prompt: options.prompt,
    destinations: targetDestinations(options.candidates.length, options.min),
    linkExile: true,
  })
}

const resolveLinkExile: InstructionHandler<'linkExile'> = (
  { draft, source, item },
  instruction,
) => {
  const stackTargets = stackObjectTargets(item)
    .filter((objectId) => {
      const object = draft.object(objectId)
      return object && validTarget(draft, object, instruction.filter, source.controller)
    })
  if (stackTargets.length > 0) {
    linkExileSelected(draft, source, stackTargets)
    return
  }

  if (instruction.perOpponent) {
    const max = instruction.perOpponent.max
    for (const seat of apnapSeats(draft)) {
      if (seat === source.controller) continue
      const candidates = matchingCandidates(draft, source, instruction.filter, false, seat)
      if (candidates.length === 0) continue
      openLinkExileChoice(draft, source, instruction.filter, {
        count: Math.min(max, candidates.length),
        min: 0,
        candidates,
        prompt: `Choose up to ${max} target(s) ${seat} controls for ${source.name}.`,
        seat: source.controller,
      })
    }
    return
  }

  const controlled = instruction.controlled === true
  const candidates = matchingCandidates(draft, source, instruction.filter, controlled)
  const max = instruction.max ?? (controlled ? candidates.length : 1)
  const min = instruction.optional || instruction.min === 0
    ? 0
    : instruction.min ?? 1
  openLinkExileChoice(draft, source, instruction.filter, {
    count: Math.min(max, candidates.length),
    min: Math.min(min, candidates.length),
    candidates,
    prompt: controlled
      ? `Choose any number of your permanents to exile with ${source.name}.`
      : `Choose target(s) for ${source.name}.`,
  })
}

const resolveReturnLinked: InstructionHandler<'returnLinkedExile'> = (
  { draft, source },
  instruction,
) => {
  releaseLinkedExile(
    draft,
    source,
    instruction.returnTo ?? 'battlefield',
  )
}

export const linkedExileInstructionHandlers = {
  linkExile: resolveLinkExile,
  returnLinkedExile: resolveReturnLinked,
}
