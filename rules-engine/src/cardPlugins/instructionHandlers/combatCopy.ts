import { DIALOG_CHOSEN, setPendingDialog } from '../../pendingDialog'
import { changeStatsUntilCleanup, copyUntilCleanup } from '../../plugins/temporaryStats'
import { applyOracleLineUntilEot } from '../untilEot'
import {
  copyStackSpell,
  copyTokenTemplate,
  createToken,
} from '../effects'
import type { InstructionHandler, InstructionHandlers } from './types'

const dealDamageTargetX: InstructionHandler<'dealDamageTargetX'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  if (target) {
    draft.enqueue({
      type: 'dealDamage',
      sourceId: source.id,
      target,
      amount: Math.max(0, item?.x ?? 0),
      gainLife: { seat: source.controller },
    })
  }
}

const pumpAllCreaturesByX: InstructionHandler<'pumpAllCreaturesByX'> = (
  { draft, source, item },
  instruction,
) => {
  const amount = Math.max(0, item?.x ?? 0) * instruction.multiplier
  for (const object of Object.values(draft.objects)) {
    if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
    changeStatsUntilCleanup(draft, source.controller, object, amount, amount)
  }
}

const teferiSunsetPlusOne: InstructionHandler<'teferiSunsetPlusOne'> = (
  { draft, source, item },
) => {
  for (const target of item?.targets ?? []) {
    if (target.kind !== 'object') continue
    const object = draft.object(target.objectId)
    if (!object || object.zone !== 'battlefield') continue
    draft.enqueue({
      type: object.controller === source.controller ? 'untap' : 'tap',
      objectId: object.id,
    })
  }
  draft.enqueue({
    type: 'gainLife',
    seat: source.controller,
    amount: 2,
    source: source.id,
  })
}

const dealDamageToChosenTarget: InstructionHandler<'dealDamageToChosenTarget'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  if (target) {
    draft.enqueue({
      type: 'dealDamage',
      sourceId: source.id,
      target,
      amount: instruction.amount,
    })
  }
}

const fightUpToOne: InstructionHandler<'fightUpToOne'> = ({ draft, source }) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'fight-target',
    prompt: `Choose up to one creature ${source.name} fights.`,
    waiting: 'is choosing a creature to fight.',
    judge: `Waiting for ${source.name} to pick a fight.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    types: ['Creature'],
    optional: true,
    sequence: draft.allocTs(),
    requirements: { target: { max: 1 } },
  })
}

const fight: InstructionHandler<'fight'> = ({ draft, source, item }, instruction) => {
  const self = { kind: 'object', objectId: source.id } satisfies {
    kind: 'object'
    objectId: string
  }
  const left = instruction.with === 'self-target'
    ? self
    : item?.targets[0]
  const right = instruction.with === 'self-target'
    ? item?.targets[0]
    : item?.targets[1]
  if (left?.kind === 'object' && right?.kind === 'object') {
    const first = draft.object(left.objectId)
    const second = draft.object(right.objectId)
    if (first && second) {
      draft.enqueue({ type: 'fight', leftId: first.id, rightId: second.id })
    }
  }
}

const exchangeControlUntilEot: InstructionHandler<'exchangeControlUntilEot'> = (
  { draft, source, item },
) => {
  const opponent = item?.targets.find((target) => target.kind === 'player')
  if (opponent?.kind !== 'player') return
  const you = source.controller
  const them = opponent.player
  const swaps: Array<{ objectId: string; previous: string; oracleText: string }> = []
  for (const object of Object.values(draft.objects)) {
    if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
    if (object.controller !== you && object.controller !== them) continue
    swaps.push({
      objectId: object.id,
      previous: object.controller,
      oracleText: object.oracleText,
    })
    object.controller = object.controller === you ? them : you
    object.tapped = false
    applyOracleLineUntilEot(object, 'Haste')
  }
  const current = draft.players[you].data['reinsOfPower.swaps']
  const previous: Array<{ objectId: string; previous: string; oracleText?: string }> =
    Array.isArray(current) ? current : []
  draft.players[you].data['reinsOfPower.swaps'] = [...previous, ...swaps]
  draft.note(`${you} exchanges creature control with ${them}`)
}

const createTokenHandler: InstructionHandler<'createToken'> = (
  { draft, source },
  instruction,
) => {
  createToken(draft, source.controller, {
    name: instruction.token.name,
    types: instruction.token.types,
    subtypes: instruction.token.subtypes ?? [],
    power: instruction.token.power ?? null,
    toughness: instruction.token.toughness ?? null,
    oracleText: instruction.token.oracleText ?? '',
  })
}

const copySelf: InstructionHandler<'copySelf'> = ({ draft, source }) => {
  const live = draft.object(source.id) ?? source
  createToken(draft, live.controller, copyTokenTemplate(live))
}

const copyControlledCreature: InstructionHandler<'copyControlledCreature'> = (
  { draft, source },
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'copy-creature',
    prompt: 'You may have this enter as a copy of a creature you control.',
    waiting: 'is choosing a creature to copy.',
    judge: 'Waiting for an optional clone.',
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    types: ['Creature'],
    optional: true,
    requirements: { target: { max: 1 } },
  })
}

const copyTargetCreature: InstructionHandler<'copyTargetCreature'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  const copied = draft.object(target.objectId)
  if (!copied) return
  createToken(draft, source.controller, copyTokenTemplate(copied, {
    notLegendary: instruction.notLegendary,
    flying: instruction.flying,
  }))
}

const createXTokens: InstructionHandler<'createXTokens'> = (
  { draft, source, item },
  instruction,
) => {
  const count = Math.max(0, item?.x ?? 0)
  for (let index = 0; index < count; index += 1) {
    createToken(draft, source.controller, {
      name: instruction.token.name,
      types: instruction.token.types,
      subtypes: instruction.token.subtypes ?? [],
      power: instruction.token.power ?? null,
      toughness: instruction.token.toughness ?? null,
      oracleText: instruction.token.oracleText ?? '',
    })
  }
}

const dealDamageToSelf: InstructionHandler<'dealDamageToSelf'> = (
  { draft, source },
  instruction,
) => {
  draft.enqueue({
    type: 'dealDamage',
    sourceId: source.id,
    target: { kind: 'player', player: source.controller },
    amount: instruction.amount,
  })
}

const preventCombatDamage: InstructionHandler<'preventCombatDamage'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  const sourceId = instruction.from === 'target' && target?.kind === 'object'
    ? target.objectId
    : undefined
  draft.enqueue({
    type: 'addRule',
    pluginId: 'fog',
    params: {
      untilCleanup: true,
      ...(sourceId ? { sourceId } : {}),
      ...(instruction.toController ? { defender: source.controller } : {}),
    },
  })
}

const copyAllCreaturesUntilEot: InstructionHandler<'copyAllCreaturesUntilEot'> = (
  { draft, source, item },
  instruction,
) => {
  const target = item?.targets[0]
  const copied = target?.kind === 'object' ? draft.object(target.objectId) : undefined
  if (!copied) return
  for (const object of Object.values(draft.objects)) {
    if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
    if (object.id === copied.id) continue
    copyUntilCleanup(draft, source.controller, object, copied, {
      notLegendary: instruction.notLegendary,
    })
  }
}

const combatDialogueUntilEot: InstructionHandler<'combatDialogueUntilEot'> = (
  { draft, item },
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  draft.enqueue({
    type: 'addRule',
    pluginId: 'combatDialogue',
    params: { creatureId: target.objectId, untilCleanup: true },
  })
}

const fightOwnedVsOpponent: InstructionHandler<'fightOwnedVsOpponent'> = (
  { draft, source },
) => {
  setPendingDialog(draft, {
    sourceId: source.id,
    source: source.name,
    seat: source.controller,
    kind: 'fight-own',
    prompt: 'Choose a creature you control to fight.',
    waiting: 'is choosing a creature to fight with.',
    judge: `Waiting for ${source.name} fight targets.`,
    chosenEvent: DIALOG_CHOSEN,
    destinations: ['skip', 'target'],
    types: ['Creature'],
    optional: true,
    requirements: { target: { max: 1 } },
  })
}

const copyTargetSpell: InstructionHandler<'copyTargetSpell'> = (
  { draft, source, item },
) => {
  const target = item?.targets[0]
  if (target?.kind !== 'object') return
  const copied = draft.object(target.objectId)
  const stackItem = draft.stack.find((candidate) => candidate.objectId === target.objectId)
  if (!copied || !stackItem || copied.zone !== 'stack') return
  copyStackSpell(draft, copied, stackItem, source.controller)
  draft.note(`${source.name} copies ${copied.name}`)
}

export const combatCopyHandlers = {
  dealDamageTargetX,
  pumpAllCreaturesByX,
  teferiSunsetPlusOne,
  dealDamageToChosenTarget,
  fightUpToOne,
  fight,
  exchangeControlUntilEot,
  createToken: createTokenHandler,
  copySelf,
  copyControlledCreature,
  copyTargetCreature,
  createXTokens,
  dealDamageToSelf,
  preventCombatDamage,
  copyAllCreaturesUntilEot,
  combatDialogueUntilEot,
  fightOwnedVsOpponent,
  copyTargetSpell,
} satisfies Partial<InstructionHandlers>
