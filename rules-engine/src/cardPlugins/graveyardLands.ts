import type { Plugin } from '../types'
import { AFTERMATH_RECLAIM, activated } from './activated'
import { onResolve } from './onResolve'

export { AFTERMATH_RECLAIM }

export const graveyardLands: Plugin = {
  id: 'graveyardLands',
  legal: activated.legal,
  apply: (ctx) => {
    activated.apply?.(ctx)
    onResolve.apply?.(ctx)
  },
}
