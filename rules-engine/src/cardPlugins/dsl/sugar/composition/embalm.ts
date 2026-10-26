import { activated, copy, exileSourceCost, manaCost, ref } from '../../builders'

export const embalm = (cost: string) => activated({
  availableFrom: ['graveyard'], timing: 'sorcery', costs: [manaCost(cost), exileSourceCost('graveyard')],
  instructions: [copy({ targets: ref('source'), information: 'currentOrLastKnown', except: { colors: 'W', subtypes: ['Zombie'], noManaCost: true } })],
})
