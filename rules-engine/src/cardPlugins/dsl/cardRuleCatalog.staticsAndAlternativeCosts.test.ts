import { expect, test } from 'bun:test'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'

test('entry lands compose conditional replacement, reveal choice, and untapped-entry programs', () => {
  const sanctuary = cardRuleDefinitionSnapshotFor('Mystic Sanctuary')!.definition.abilities
  expect(sanctuary).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', transform: { kind: 'modifyEvent', changes: { tapped: true } }, when: { kind: 'compareAmount', operator: 'lte', right: { kind: 'constant', value: 2 } } }] },
    { kind: 'triggered', on: { kind: 'enters', filter: { all: [{ kind: 'contextRef', name: 'source' }, { tapped: false }] } }, instructions: [{ kind: 'chooseInstructions', optional: true, options: [{ instructions: [{ kind: 'move', to: 'library', position: 'top' }] }, { instructions: [] }] }] },
  ])
  const estuary = cardRuleDefinitionSnapshotFor('Choked Estuary')!.definition.abilities
  expect(estuary).toMatchObject([
    { kind: 'static', effects: [{ kind: 'replacement', program: [
      { kind: 'chooseCards', bindChoice: 'revealed', filter: { filter: { zone: 'hand', owner: 'you', any: [{ subtypes: ['Island'] }, { subtypes: ['Swamp'] }] } }, min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } },
      { kind: 'reveal', targets: { kind: 'choiceRef', binding: 'revealed' } },
      { kind: 'branch', then: [{ kind: 'modifyEvent', changes: { tapped: true } }] },
    ] }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], instructions: [{ kind: 'chooseInstructions', options: [
      { label: 'U', instructions: [{ kind: 'addMana', amount: { U: { kind: 'constant', value: 1 } } }] },
      { label: 'B', instructions: [{ kind: 'addMana', amount: { B: { kind: 'constant', value: 1 } } }] },
    ] }] },
  ])
})
