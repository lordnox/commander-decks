import type { TriggerBindingIf } from '../types'
import type { CardCondition } from './effectDefinitions'

export const otherLands = (
  bounds: { min?: number; max?: number; subtype?: string },
): CardCondition => ({ kind: 'otherLands', ...bounds })

export const controlledLands = (bounds: { min?: number; max?: number }): CardCondition => ({
  kind: 'controlledLands',
  ...bounds,
})

export const controlledBasicLands = (
  bounds: { min?: number; max?: number },
): CardCondition => ({
  kind: 'controlledBasicLands',
  ...bounds,
})

export const uniqueLandNames = (min: number): CardCondition => ({
  kind: 'uniqueLandNames',
  min,
})

export const controlledCreaturePower = (min: number): CardCondition => ({
  kind: 'controlledCreaturePower',
  min,
})

export const graveyardCards = (min: number): CardCondition => ({
  kind: 'graveyardCards',
  min,
})

export const graveyardPermanentCards = (min: number): CardCondition => ({
  kind: 'graveyardPermanentCards',
  min,
})

export const graveyardCardTypes = (min: number): CardCondition => ({
  kind: 'graveyardCardTypes',
  min,
})

/** "If it doesn't have the same name as another creature you control or a creature card in your graveyard." */
export const triggeringCreatureNameUnique = (): CardCondition => ({
  kind: 'triggeringCreatureNameUnique',
})

/** After this player draws their second card this turn. */
export const secondCardDrawn = (): TriggerBindingIf => ({
  seat: 'controller',
  cardsDrawnThisTurn: 2,
})

export const stackXAtLeast = (min: number): CardCondition => ({
  kind: 'stackXAtLeast',
  min,
})

export const controllerLife = (min: number): CardCondition => ({
  kind: 'controllerLife',
  min,
})

export const lacksControlledSubtype = (...subtypes: string[]): CardCondition => ({
  kind: 'lacksControlledSubtype',
  subtypes,
})

export const opponentsAtMost = (max: number): CardCondition => ({
  kind: 'opponentsAtMost',
  max,
})

export const opponentHasMore = (
  stat: Extract<CardCondition, { kind: 'opponentHasMore' }>['stat'],
): CardCondition => ({
  kind: 'opponentHasMore',
  stat,
})

export const opponentLostLifeThisTurn = (min: number): CardCondition => ({
  kind: 'opponentLostLifeThisTurn',
  min,
})

export const opponentDealtCombatDamageByLegendaryThisTurn = (
  controller: 'you' | 'any' = 'any',
): CardCondition => ({
  kind: 'opponentDealtCombatDamageByLegendaryThisTurn',
  ...(controller === 'you' ? { controller } : {}),
})
