import { enters, dies, leaves, attacks, ref } from '../builders'

export const self = Object.freeze({
  get attacks() { return attacks({ filter: ref('self') }) },
  get enters() { return enters({ filter: ref('self') }) },
  get dies() { return dies({ filter: ref('self') }) },
  get leaves() { return leaves({ filter: ref('self') }) },
})
