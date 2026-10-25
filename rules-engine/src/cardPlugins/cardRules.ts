import type { GameObject } from '../types'

// Every card is authored in the canonical catalog; #487 removes explicit legacy effects with their runtime.
export const effectsOf = (object: Partial<Pick<GameObject, 'effects'>>) => object.effects ?? []
