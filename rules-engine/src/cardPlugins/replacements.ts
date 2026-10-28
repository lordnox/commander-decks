import type { CardCondition, CardEffect } from './effectDefinitions'

export const entersTapped = (condition?: CardCondition): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'tapSelf',
  ...(condition ? { if: condition } : {}),
})

/** "As this enters, choose a color." The pick is stored as `chosenColor`. */
export const chooseColorOnEnter = (): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'chooseColor',
})

export const tapUnlessPayLife = (life: number): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'tapUnlessPayLife',
  life,
})

export const tapUnlessRevealSubtype = (...subtypes: string[]): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'tapUnlessRevealSubtype',
  subtypes,
})

export const replaceDrawByType = (): CardEffect => ({ op: 'drawReplacementByType' })
