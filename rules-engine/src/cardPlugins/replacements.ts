import type { CardEffect } from './effectDefinitions'

/** "As this enters, choose a color." The pick is stored as `chosenColor`. */
export const chooseColorOnEnter = (): CardEffect => ({
  op: 'replacement',
  on: 'enters',
  do: 'chooseColor',
})

export const replaceDrawByType = (): CardEffect => ({ op: 'drawReplacementByType' })
