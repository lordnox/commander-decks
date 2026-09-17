import type { Plugin } from '../types'

// Trigger dispatch lives in rules/triggers.ts (CR 603.3).
export const landfall: Plugin = {
  id: 'landfall',
  apply: () => {},
}
