import type Draft from '../draft'
import { openCardSelection } from '../rules/selectCards'
import type { GameState, GameObject, PlayerId, StackItem } from '../types'
import type { TargetFilter } from './effectDefinitions'
import { validTarget } from './targetedResolve'
import type { InstructionHandler } from './instructionHandlers/types'

export const isOpponent = (
  state: Pick<GameState, 'players'>,
  seat: PlayerId,
  of: PlayerId,
) => seat !== of && !state.players[seat].lost

export const linkMonarchExileSelected = (
  draft: Draft,
  source: GameObject,
  objectIds: string[],
) => {
  const linked = [...(source.exiledCards ?? [])]
  for (const objectId of objectIds) {
    const card = draft.object(objectId)
    if (!card || card.zone !== 'battlefield') continue
    card.exiledWith = source.id
    card.exiledUntilOpponentMonarch = true
    linked.push(card.id)
    draft.enqueue({ type: 'move', objectId: card.id, to: 'exile' })
  }
  source.exiledCards = linked
  if (objectIds.length > 0) {
    draft.note(`${source.name} exiles ${objectIds.length} card(s) until an opponent is monarch`)
  }
}

export const releaseMonarchExilesFor = (draft: Draft, newMonarch: PlayerId) => {
  for (const source of Object.values(draft.objects)) {
    const ids = source.exiledCards
    if (!ids?.length) continue
    const jailer = source.controller
    if (!isOpponent(draft, newMonarch, jailer)) continue
    const remaining: string[] = []
    for (const objectId of ids) {
      const card = draft.object(objectId)
      if (!card?.exiledUntilOpponentMonarch || card.exiledWith !== source.id) {
        remaining.push(objectId)
        continue
      }
      delete card.exiledUntilOpponentMonarch
      delete card.exiledWith
      draft.enqueue({
        type: 'move',
        objectId: card.id,
        to: 'battlefield',
        controller: card.owner,
      })
    }
    if (remaining.length > 0) source.exiledCards = remaining
    else delete source.exiledCards
  }
}

const stackObjectTargets = (item?: StackItem) =>
  item?.targets.flatMap((target) => target.kind === 'object' ? [target.objectId] : []) ?? []

const matchingCandidates = (
  draft: Draft,
  source: GameObject,
  filter: TargetFilter,
) => Object.values(draft.objects)
  .filter((object) => {
    if (object.zone !== 'battlefield') return false
    return validTarget(draft, object, filter, source.controller)
  })
  .map((object) => object.id)

const openMonarchExileChoice = (
  draft: Draft,
  source: GameObject,
  filter: TargetFilter,
  options: { count: number; min: number; candidates: string[]; prompt: string },
) => {
  if (options.candidates.length === 0 && options.min > 0) return
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: options.count,
    min: options.min,
    candidates: options.candidates,
    sourceId: source.id,
    source: source.name,
    prompt: options.prompt,
    destinations: ['target'],
    exileUntilOpponentMonarch: true,
  })
}

const resolveExileUntilOpponentBecomesMonarch: InstructionHandler<
  'exileUntilOpponentBecomesMonarch'
> = ({ draft, source, item }, instruction) => {
  const stackTargets = stackObjectTargets(item)
    .filter((objectId) => {
      const object = draft.object(objectId)
      return object && validTarget(draft, object, instruction.filter, source.controller)
    })
  if (stackTargets.length > 0) {
    linkMonarchExileSelected(draft, source, stackTargets)
    return
  }

  const candidates = matchingCandidates(draft, source, instruction.filter)
  const max = instruction.max ?? 1
  const min = instruction.optional || instruction.min === 0
    ? 0
    : instruction.min ?? 1
  openMonarchExileChoice(draft, source, instruction.filter, {
    count: Math.min(max, candidates.length),
    min: Math.min(min, candidates.length),
    candidates,
    prompt: `Choose target creature an opponent controls for ${source.name}.`,
  })
}

const resolveBecomeMonarch: InstructionHandler<'becomeMonarch'> = ({ draft, source }) => {
  draft.enqueue({ type: 'becomeMonarch', seat: source.controller })
}

export const monarchExileInstructionHandlers = {
  becomeMonarch: resolveBecomeMonarch,
  exileUntilOpponentBecomesMonarch: resolveExileUntilOpponentBecomesMonarch,
}
