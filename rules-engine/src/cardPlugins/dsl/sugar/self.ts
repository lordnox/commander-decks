import { enters, dies, leaves, ref } from '../builders'

export const self = Object.freeze({
  get enters() { return enters({ filter: ref('self') }) },
  get dies() { return dies({ filter: ref('self') }) },
  get leaves() { return leaves({ filter: ref('self') }) },
})
