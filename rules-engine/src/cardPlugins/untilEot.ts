import type {
  CopySnapshot,
  GameObject,
  Plugin,
  UntilEotChange,
} from '../types'

export const snapshotCopy = (object: GameObject): CopySnapshot => ({
  name: object.name,
  printedName: object.printedName,
  types: [...object.types],
  subtypes: [...object.subtypes],
  supertypes: [...object.supertypes],
  manaCost: object.manaCost,
  manaValue: object.manaValue,
  colors: [...object.colors],
  power: object.power,
  toughness: object.toughness,
  oracleText: object.oracleText,
  grantedRules: [...object.grantedRules],
  tapProduces: object.tapProduces ? { ...object.tapProduces } : undefined,
  effects: object.effects ? structuredClone(object.effects) : undefined,
})

export const restoreCopy = (object: GameObject, snapshot: CopySnapshot) => {
  object.name = snapshot.name
  object.printedName = snapshot.printedName
  object.types = [...snapshot.types]
  object.subtypes = [...snapshot.subtypes]
  object.supertypes = [...snapshot.supertypes]
  object.manaCost = snapshot.manaCost
  object.manaValue = snapshot.manaValue
  object.colors = [...snapshot.colors]
  object.power = snapshot.power
  object.toughness = snapshot.toughness
  object.oracleText = snapshot.oracleText
  object.grantedRules = [...snapshot.grantedRules]
  object.tapProduces = snapshot.tapProduces ? { ...snapshot.tapProduces } : undefined
  object.effects = snapshot.effects ? structuredClone(snapshot.effects) : undefined
}

export const pushUntilEot = (object: GameObject, change: UntilEotChange) => {
  object.untilEot = [...(object.untilEot ?? []), change]
}

export const applyPumpUntilEot = (
  object: GameObject,
  power: number,
  toughness: number,
) => {
  if (object.power !== null) object.power += power
  if (object.toughness !== null) object.toughness += toughness
  pushUntilEot(object, { kind: 'pump', power, toughness })
}

export const applyOracleLineUntilEot = (object: GameObject, line: string) => {
  if (object.oracleText.split('\n').includes(line)) return
  object.oracleText = object.oracleText ? `${object.oracleText}\n${line}` : line
  pushUntilEot(object, { kind: 'oracleLine', line })
}

const removeLastOracleLine = (object: GameObject, line: string) => {
  const lines = object.oracleText.split('\n')
  const index = lines.lastIndexOf(line)
  if (index < 0) return
  lines.splice(index, 1)
  object.oracleText = lines.join('\n')
}

const revertUntilEot = (object: GameObject) => {
  const changes = object.untilEot ?? []
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index]
    if (change.kind === 'pump') {
      if (object.power !== null) object.power -= change.power
      if (object.toughness !== null) object.toughness -= change.toughness
    } else if (change.kind === 'oracleLine') {
      removeLastOracleLine(object, change.line)
    } else if (change.kind === 'copy') {
      restoreCopy(object, change.snapshot)
    } else if (change.kind === 'controller' && object.zone === 'battlefield') {
      object.controller = change.previous
    }
  }
  delete object.untilEot
}

export const untilEot: Plugin = {
  id: 'untilEot',
  apply: ({ event, draft }) => {
    if (event.type !== 'custom' || event.name !== 'advanceStep' || draft.step !== 'cleanup') {
      return
    }
    for (const object of draft.zoneOf('battlefield')) revertUntilEot(object)
  },
}
