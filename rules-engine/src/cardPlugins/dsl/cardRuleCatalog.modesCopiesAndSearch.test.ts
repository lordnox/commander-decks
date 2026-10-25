import { expect, test } from 'bun:test'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'

test('bounded-library catalog programs compose typed choices, remainder routing, and canonical token abilities', () => {
  for (const name of ["Animist's Awakening", 'Malevolent Rumble', 'Planar Genesis', 'Satyr Wayfinder', 'Silverback Elder']) {
    const snapshot = cardRuleDefinitionSnapshotFor(name)!
    expect(snapshot).toBeDefined()
    const ability = snapshot.definition.abilities[0]!
    switch (name) {
      case 'Silverback Elder':
        if (ability.kind !== 'triggered' || !ability.modes) throw new Error('expected modal trigger')
        expect(ability.on).toEqual({ kind: 'cast', filter: { type: 'Creature', controller: 'you' } })
        expect(ability.modes).toHaveLength(3)
        expect(ability.modes[1]!.instructions[0]).toEqual({ kind: 'inspectTop', player: { kind: 'contextRef', name: 'controller' }, count: { kind: 'constant', value: 5 }, bindChoice: 'top', visibility: 'private' })
        break
      default: {
        if (!('instructions' in ability) || !ability.instructions) throw new Error('expected instruction program')
        const inspection = ability.instructions[0]!
        expect(inspection).toEqual(expect.objectContaining({ kind: 'inspectTop', bindChoice: 'top', visibility: name === 'Planar Genesis' ? 'private' : 'public' }))
        if (name === 'Malevolent Rumble') {
          const token = ability.instructions.at(-1)!
          if (token.kind !== 'createToken') throw new Error('expected token creation')
          expect(token.token).toEqual(expect.objectContaining({ power: 0, toughness: 1, subtypes: ['Eldrazi', 'Spawn'] }))
          expect(token.token.abilities?.[0]).toEqual(expect.objectContaining({ kind: 'activated', costs: [expect.objectContaining({ kind: 'sacrifice' })], instructions: [{ kind: 'addMana', targets: { kind: 'contextRef', name: 'controller' }, amount: { C: { kind: 'constant', value: 1 } } }] }))
        }
        if (name === "Animist's Awakening") {
          expect(inspection).toEqual(expect.objectContaining({ count: { kind: 'variable', name: 'X' } }))
          expect(ability.instructions[1]).toEqual(expect.objectContaining({ kind: 'move', to: 'battlefield', tapped: true, bindChoice: 'lands' }))
          expect(ability.instructions.at(-1)?.kind).toBe('if')
        }
      }
    }
  }
})

test('Dack catalog composes reveal, movement, shuffle, permanent goad, and distinct assignments', () => {
  const snapshot = cardRuleDefinitionSnapshotFor('Dack Fayden, Helping Hand')!
  expect(snapshot.definition.abilities).toMatchObject([{
    kind: 'triggered', activeIn: ['battlefield'], on: { kind: 'enters', filter: { kind: 'contextRef', name: 'source' } },
    instructions: [
      { kind: 'revealUntil', count: { kind: 'count', of: { kind: 'players', filter: { relation: 'opponent' } } }, match: { kind: 'objects', filter: { zone: 'library', type: 'Creature' } }, foundTo: 'library', rest: 'keep', bindFound: 'found' },
      { kind: 'move', targets: { kind: 'choiceRef', binding: 'found' }, to: 'battlefield', controller: { kind: 'contextRef', name: 'controller' }, bindChoice: 'entered' },
      { kind: 'shuffle', targets: { kind: 'contextRef', name: 'controller' } },
      { kind: 'createEffect', targets: { kind: 'choiceRef', binding: 'entered' }, effect: { kind: 'goad' }, duration: { kind: 'permanent' } },
      { kind: 'distributeControl', targets: { kind: 'choiceRef', binding: 'entered' }, recipients: { kind: 'players', filter: { relation: 'opponent' } }, distinct: true },
    ],
  }])
})


test('council and pile catalog programs preserve secrecy, complete outcomes, and player scopes', () => {
  const programs = (name: string) => cardRuleDefinitionSnapshotFor(name)!.definition.abilities
  expect(programs('Illusion of Choice')).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'modifyVotes', players: { kind: 'players', filter: {} }, controller: { name: 'controller' }, duration: 'untilEndOfTurn' }, { kind: 'draw' }] }])
  expect(programs('Erestor of the Council')).toMatchObject([{ kind: 'triggered', on: { kind: 'votesFinished', bindResult: 'vote' }, instructions: [{ kind: 'createToken', targets: { filter: { relation: 'opponent', voted: { agreement: 'same' } } } }, { kind: 'scry', count: { kind: 'count', of: { filter: { relation: 'opponent', voted: { agreement: 'different' } } } } }, { kind: 'draw' }] }])
  const council = programs('Círdan the Shipwright')
  expect(council).toMatchObject([{ kind: 'keyword', keyword: 'vigilance' }, { kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'vote', secret: true }, { kind: 'forEachPlayer', instructions: [{ kind: 'draw' }] }, { kind: 'forEachPlayer', instructions: [{ kind: 'if' }] }] }, { kind: 'triggered', on: { kind: 'attacks' } }])
  expect(programs('Trap the Trespassers')).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'vote', secret: true, bindObjects: 'voted', options: { kind: 'objects', filter: { filter: { type: 'Creature', not: { controller: 'you' } } } } }, { kind: 'forEach', instructions: [{ kind: 'putCounters', counter: 'stun' }, { kind: 'tap' }] }] }])
  expect(programs("Fortune's Favor")).toMatchObject([{ kind: 'spell', decisions: { targets: [{ filter: { kind: 'players', filter: { relation: 'opponent' } } }] }, instructions: [{ kind: 'inspectTop', count: { value: 4 }, visibility: 'private' }, { kind: 'partitionPiles', visibility: 'facedown-faceup' }, { kind: 'move', to: 'hand' }, { kind: 'move', to: 'graveyard' }] }])
  expect(programs('Hostile Negotiations')).toMatchObject([{ kind: 'spell', instructions: [{ kind: 'inspectTop', count: { value: 3 } }, { kind: 'move', to: 'exile', faceDown: true }, { kind: 'inspectTop', count: { value: 3 } }, { kind: 'move', to: 'exile', faceDown: true }, { kind: 'lookAt' }, { kind: 'lookAt' }, { kind: 'choosePile' }, { kind: 'reveal', turnFaceUp: true }, { kind: 'choosePlayer', filter: { filter: { relation: 'opponent' } } }, { kind: 'choosePile' }, { kind: 'move', to: 'hand' }, { kind: 'move', to: 'graveyard' }, { kind: 'loseLife', amount: { value: 3 } }] }])
})
