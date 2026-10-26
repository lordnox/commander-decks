import type { VariableSpec } from './schema/v2'

export const variableManaColor = (variables: readonly VariableSpec[] | undefined) =>
  variables?.find(variable => variable.name === 'X')?.manaColor

export const expandVariableMana = (cost: string, x: number) =>
  cost.replaceAll('{X}', x > 0 ? `{${x}}` : '')
