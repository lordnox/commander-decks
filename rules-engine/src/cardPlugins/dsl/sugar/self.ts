import { attacks, cardCycled, dealtDamage, dies, enters, leaves, ref } from '../builders'

export const self = Object.freeze({
  get attacks() { return attacks({ filter: ref('self') }) },
  get enters() { return enters({ filter: ref('self') }) },
  get dies() { return dies({ filter: ref('self') }) },
  get leaves() { return leaves({ filter: ref('self') }) },
  get cycles() { return cardCycled({ object: ref('self') }) },
  get dealtDamage() { return dealtDamage({ recipient: ref('self') }) },
})
