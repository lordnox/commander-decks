import type Draft from '../draft'
import { openCardSelection } from '../rules/selectCards'
import type { GameObject, GameState, Plugin } from '../types'
import {
  changeStatsUntilEndOfTurn,
  linkedExileCardIds,
  pumpPerLinkedExileOutOfSync,
  refreshPumpPerLinkedExile,
} from './continuousEffects'
import { enteringObjectId } from './entersTapped'
import { manaValueOf } from './effectRuntime'
import type { InstructionHandler } from './instructionHandlers/types'

const SYNC = 'exilePayoffs.sync'

const pumpPerLinkedExileSpec = (object: GameObject) => {
  for (const effect of object.effects ?? []) {
    if (effect.op === 'static' && effect.pumpPerLinkedExile) {
      return effect.pumpPerLinkedExile
    }
  }
}

export const unlinkLinkedExile = (
  draft: Draft,
  source: GameObject,
  cardId: string,
) => {
  source.exiledCards = (source.exiledCards ?? []).filter((id) => id !== cardId)
  const card = draft.object(cardId)
  if (card?.exiledWith === source.id) delete card.exiledWith
}

const powerOf = (card: GameObject | undefined) =>
  card?.power ?? 0

const pumpRecipient = (
  ctx: { draft: Draft; source: GameObject; item?: { targets: { kind: string; objectId?: string }[] } },
  applyTo: 'self' | 'stackTarget',
) => {
  if (applyTo === 'self') return ctx.draft.object(ctx.source.id)
  const target = ctx.item?.targets.find((entry) => entry.kind === 'object')
  return target?.objectId ? ctx.draft.object(target.objectId) : undefined
}

const applyPumpFromLinkedExile = (
  ctx: { draft: Draft; source: GameObject; item?: { targets: { kind: string; objectId?: string }[] } },
  linkedExileId: string,
  applyTo: 'self' | 'stackTarget',
) => {
  const exileCard = ctx.draft.object(linkedExileId)
  const bonus = powerOf(exileCard)
  if (bonus <= 0) return
  const recipient = pumpRecipient(ctx, applyTo)
  if (!recipient || recipient.power === null || recipient.toughness === null) return
  changeStatsUntilEndOfTurn(recipient, bonus, bonus)
}

const resolveLinkedExileId = (
  ctx: { draft: Draft; source: GameObject; item?: { targets: { kind: string; objectId?: string }[] } },
) => {
  const linked = linkedExileCardIds(ctx.draft, ctx.source)
  if (linked.length === 1) return linked[0]
  const target = ctx.item?.targets.find((entry) => entry.kind === 'object')
  if (target?.objectId && linked.includes(target.objectId)) return target.objectId
  return undefined
}

const openLinkedExileChoice = (
  draft: Draft,
  source: GameObject,
  linked: string[],
  prompt: string,
  triggerInstructions: Parameters<typeof openCardSelection>[1]['triggerInstructions'],
) => {
  openCardSelection(draft, {
    seat: source.controller,
    kind: 'choose',
    count: 1,
    min: 1,
    candidates: linked,
    sourceId: source.id,
    source: source.name,
    prompt,
    destinations: ['target'],
    triggerInstructions,
  })
}

const pumpFromLinkedExilePower: InstructionHandler<'pumpFromLinkedExilePower'> = (
  ctx,
  instruction,
) => {
  const linked = linkedExileCardIds(ctx.draft, ctx.source)
  if (linked.length === 0) return
  const chosen = resolveLinkedExileId(ctx)
  if (chosen) {
    applyPumpFromLinkedExile(ctx, chosen, instruction.applyTo)
    return
  }
  openLinkedExileChoice(
    ctx.draft,
    ctx.source,
    linked,
    `Choose a card exiled with ${ctx.source.name}.`,
    [{ kind: 'pumpFromLinkedExilePowerApply', applyTo: instruction.applyTo }],
  )
}

const pumpFromLinkedExilePowerApply: InstructionHandler<'pumpFromLinkedExilePowerApply'> = (
  ctx,
  instruction,
) => {
  const linkedExileId = resolveLinkedExileId(ctx)
  if (!linkedExileId) return
  applyPumpFromLinkedExile(ctx, linkedExileId, instruction.applyTo)
}

const putLinkedExileToGraveyardGainLife: InstructionHandler<'putLinkedExileToGraveyardGainLife'> = (
  ctx,
) => {
  const linked = linkedExileCardIds(ctx.draft, ctx.source)
  if (linked.length === 0) return
  const chosen = resolveLinkedExileId(ctx)
  if (chosen) {
    moveLinkedExileToGraveyardGainLife(ctx, chosen)
    return
  }
  openLinkedExileChoice(
    ctx.draft,
    ctx.source,
    linked,
    `Choose a card exiled with ${ctx.source.name} to put into its owner's graveyard.`,
    [{ kind: 'putLinkedExileToGraveyardGainLifeApply' }],
  )
}

const putLinkedExileToGraveyardGainLifeApply: InstructionHandler<'putLinkedExileToGraveyardGainLifeApply'> = (
  ctx,
) => {
  const linkedExileId = resolveLinkedExileId(ctx)
  if (!linkedExileId) return
  moveLinkedExileToGraveyardGainLife(ctx, linkedExileId)
}

const moveLinkedExileToGraveyardGainLife = (
  ctx: { draft: Draft; source: GameObject },
  linkedExileId: string,
) => {
  const card = ctx.draft.object(linkedExileId)
  if (!card || card.zone !== 'exile' || card.exiledWith !== ctx.source.id) return
  const life = manaValueOf(card)
  unlinkLinkedExile(ctx.draft, ctx.source, linkedExileId)
  ctx.draft.enqueue({ type: 'move', objectId: linkedExileId, to: 'graveyard' })
  if (life > 0) {
    ctx.draft.enqueue({
      type: 'gainLife',
      seat: ctx.source.controller,
      amount: life,
      source: ctx.source.id,
    })
  }
}

export const exilePayoffsInstructionHandlers = {
  pumpFromLinkedExilePower,
  pumpFromLinkedExilePowerApply,
  putLinkedExileToGraveyardGainLife,
  putLinkedExileToGraveyardGainLifeApply,
}

const refreshAll = (draft: GameState) => {
  for (const object of Object.values(draft.objects)) {
    const spec = pumpPerLinkedExileSpec(object)
    if (spec) refreshPumpPerLinkedExile(draft, object, spec)
  }
}

const shouldRefresh = (
  event: Parameters<NonNullable<Plugin['apply']>>[0]['event'],
  state: GameState,
) =>
  event.type === 'move'
  || Boolean(enteringObjectId(event, state))
  || (event.type === 'custom' && event.name === SYNC)
  || (event.type === 'custom' && event.name === 'pitOfOfferings.linkExiled')

const needsSync = (state: GameState) =>
  Object.values(state.objects).some((object) => {
    const spec = pumpPerLinkedExileSpec(object)
    return spec ? pumpPerLinkedExileOutOfSync(state, object, spec) : false
  })

export const exilePayoffs: Plugin = {
  id: 'exilePayoffs',
  apply: ({ state, event, draft }) => {
    if (!shouldRefresh(event, state)) return
    refreshAll(draft)
  },
  sba: ({ state }) =>
    needsSync(state) ? [{ type: 'custom', name: SYNC }] : [],
}
