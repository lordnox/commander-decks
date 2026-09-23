import { stampUntilControllerNextTurn } from '../plugins/untilNextTurn'
import type { InstructionHandler, InstructionHandlers } from './instructionHandlers/types'

const phaseOutControlled: InstructionHandler<'phaseOutControlled'> = ({ draft, source }) => {
  for (const object of draft.zoneOf('battlefield', source.controller)) {
    if (object.phasedOut) continue
    draft.enqueue({ type: 'phaseOut', objectId: object.id })
  }
}

const grantProtectionFromEverything: InstructionHandler<'grantProtectionFromEverything'> = (
  { draft, source },
) => {
  draft.enqueue({
    type: 'addRule',
    pluginId: 'protectionFromEverything',
    params: stampUntilControllerNextTurn(source.controller, draft.turn),
  })
}

const lifeTotalCannotChange: InstructionHandler<'lifeTotalCannotChange'> = (
  { draft, source },
) => {
  draft.enqueue({
    type: 'addRule',
    pluginId: 'lifeTotalLock',
    params: stampUntilControllerNextTurn(source.controller, draft.turn),
  })
}

export const statusEffectHandlers = {
  phaseOutControlled,
  grantProtectionFromEverything,
  lifeTotalCannotChange,
} satisfies Partial<InstructionHandlers>
