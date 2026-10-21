import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../../formats'
import { cardTemplate } from '../../newGame'
import { createServerGame } from '../../runtime'
import { ok, resolveStack } from '../../testHelpers'
import type { GameState } from '../../types'
import { effectsFor } from '../cardRules'
import { cardRuleDefinitionSnapshotFor } from './cardRuleCatalog'
import { KEYWORDS } from './v1'

const named = (state: GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

const handCount = (state: GameState, seat: 'p1' | 'p2' = 'p1') =>
  state.zoneOrder[seat].hand.length

const murderCard = () => cardTemplate('Murder', { types: ['Instant'], manaCost: '{0}' })
const signCard = () => cardTemplate('Sign in Blood', { types: ['Sorcery'], manaCost: '{0}' })
const houndsCard = () => cardTemplate('Vampire Hounds', { types: ['Creature'], power: 2, toughness: 2 })

describe('cardRuleCatalog — targetedActions', () => {
  test('Murder destroys the chosen creature once and rejects a player target', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [murderCard()] },
      battlefield: {
        p2: [cardTemplate('Target Bear', { types: ['Creature'], power: 2, toughness: 2 })],
      },
    }, { random: () => 0 })
    const murder = named(server.state, 'Murder')
    const bear = named(server.state, 'Target Bear')
    expect(murder.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Murder'))
    expect(murder.effects).toEqual([])
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: murder.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }).ok).toBe(false)
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: murder.id,
      targets: [{ kind: 'object', objectId: bear.id }],
    }))
    expect(cast.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.objects[bear.id].zone).toBe('graveyard')
    expect(resolved.objects[murder.id].zone).toBe('graveyard')
  })

  test('Sign in Blood draws two and loses two life for the targeted player once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      hands: { p1: [signCard()] },
      libraries: {
        p2: ['Blood One', 'Blood Two', 'Blood Three'].map((name) => cardTemplate(name)),
      },
    }, { random: () => 0 })
    const sign = named(server.state, 'Sign in Blood')
    expect(sign.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Sign in Blood'))
    expect(sign.effects).toEqual([])
    expect(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: sign.id,
      targets: [{ kind: 'object', objectId: sign.id }],
    }).ok).toBe(false)
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: sign.id,
      targets: [{ kind: 'player', player: 'p2' }],
    }))
    expect(cast.stack).toHaveLength(1)
    const resolved = resolveStack(server.rules, cast)
    expect(resolved.players.p1.life).toBe(40)
    expect(resolved.players.p2.life).toBe(38)
    expect(handCount(resolved, 'p2')).toBe(2)
    expect(named(resolved, 'Blood One').zone).toBe('hand')
    expect(named(resolved, 'Blood Two').zone).toBe('hand')
    expect(resolved.objects[sign.id].zone).toBe('graveyard')
  })

  test('Vampire Hounds pays a creature-card discard and pumps once', () => {
    const server = createServerGame(commanderRules, {
      players: 2,
      battlefield: { p1: [houndsCard()] },
      hands: {
        p1: [
          cardTemplate('Fodder', { types: ['Creature'], power: 1, toughness: 1 }),
          cardTemplate('Not a Creature', { types: ['Instant'] }),
        ],
      },
    }, { random: () => 0 })
    const hounds = named(server.state, 'Vampire Hounds')
    const fodder = named(server.state, 'Fodder')
    const instant = named(server.state, 'Not a Creature')
    expect(hounds.ruleDefinition).toEqual(cardRuleDefinitionSnapshotFor('Vampire Hounds'))
    expect(hounds.effects).toEqual([])
    expect(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hounds.id,
      abilityId: '$.abilities[0]',
    }).ok).toBe(false)
    expect(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hounds.id,
      abilityId: '$.abilities[0]',
      choices: [instant.id],
    }).ok).toBe(false)
    const activated = ok(server.rules(server.state, {
      type: 'activateAbility',
      seat: 'p1',
      objectId: hounds.id,
      abilityId: '$.abilities[0]',
      choices: [fodder.id],
    }))
    expect(activated.objects[fodder.id].zone).toBe('graveyard')
    expect(activated.stack).toHaveLength(1)
    expect(activated.objects[hounds.id].power).toBe(2)
    const resolved = resolveStack(server.rules, activated)
    expect(resolved.objects[hounds.id].power).toBe(4)
    expect(resolved.objects[hounds.id].toughness).toBe(4)
    expect(resolved.stack).toHaveLength(0)
  })

})

test('group 1 catalog programs preserve any-target damage, Loran choices, and death return', () => {
  expect(cardRuleDefinitionSnapshotFor('Lightning Bolt')!.definition.abilities).toMatchObject([
    { kind: 'spell', decisions: { targets: [{ filter: { kind: 'anyTarget' } }] }, instructions: [{ kind: 'damage', amount: { kind: 'constant', value: 3 } }] },
  ])
  expect(cardRuleDefinitionSnapshotFor('Loran of the Third Path')!.definition.abilities).toMatchObject([
    { kind: 'keyword', keyword: KEYWORDS.vigilance },
    { kind: 'triggered', decisions: { targets: [{ min: { kind: 'constant', value: 0 }, max: { kind: 'constant', value: 1 } }] }, instructions: [{ kind: 'destroy' }] },
    { kind: 'activated', costs: [{ kind: 'tapSource' }], decisions: { targets: [{ filter: { kind: 'players', filter: { relation: 'opponent' } } }] }, instructions: [{ kind: 'draw', targets: { kind: 'contextRef', name: 'controller' } }, { kind: 'draw', targets: { kind: 'targetRef', clauseIndex: 0 } }] },
  ])
  const rebirth = cardRuleDefinitionSnapshotFor('Malakir Rebirth')!
  expect(cardRuleDefinitionSnapshotFor('Malakir Rebirth // Malakir Mire')).toBe(rebirth)
  expect(rebirth.definition.abilities).toMatchObject([
    { kind: 'spell', instructions: [
      { kind: 'loseLife', amount: { kind: 'constant', value: 2 } },
      { kind: 'createEffect', duration: { kind: 'untilCleanup' }, effect: { kind: 'grantAbility', ability: { kind: 'triggered', on: { kind: 'dies' }, instructions: [{ kind: 'move', targets: { kind: 'contextRef', name: 'triggering.object.after' }, to: 'battlefield', tapped: true }] } } },
    ] },
  ])
})

test('drain catalog entries compose numeric action results with life gain', () => {
  for (const name of ['Exsanguinate', 'Debt to the Deathless', 'Drain Life']) {
    const entry = cardRuleDefinitionSnapshotFor(name)!
    expect(entry).toBeDefined()
    expect(effectsFor(name)).toEqual([])
    const ability = entry.definition.abilities[0]!
    expect(ability.kind).toBe('spell')
    if (ability.kind !== 'spell' || !ability.instructions) throw new Error('expected spell instructions')
    expect(ability.decisions.variables).toHaveLength(1)
    expect(ability.instructions.at(-1)?.kind).toBe('gainLife')
    if (name === 'Drain Life') {
      expect(ability.decisions.variables?.[0]?.manaColor).toBe('B')
      expect(ability.decisions.targets[0]?.filter.kind).toBe('anyTarget')
      expect(ability.instructions.map(instruction => instruction.kind)).toEqual(['captureAmount', 'damage', 'gainLife'])
    } else {
      expect(ability.decisions.targets).toEqual([])
      expect(ability.instructions.map(instruction => instruction.kind)).toEqual(['loseLife', 'gainLife'])
      const loss = ability.instructions[0]!
      if (loss.kind !== 'loseLife') throw new Error('expected loss')
      expect(loss.targets).toEqual({ kind: 'players', filter: { relation: 'opponent' } })
      expect(loss.amount.kind).toBe(name === 'Exsanguinate' ? 'variable' : 'multiply')
    }
  }
})

test('controller follow-up catalog programs capture their recipient before removing the target', () => {
  for (const name of ["An Offer You Can't Refuse", 'Swan Song', 'Swords to Plowshares', 'Condemn']) {
    const entry = cardRuleDefinitionSnapshotFor(name)!
    expect(entry).toBeDefined()
    expect(effectsFor(name)).toEqual([])
    const ability = entry.definition.abilities[0]!
    if (ability.kind !== 'spell' || !ability.instructions) throw new Error('expected spell instructions')
    expect(ability.instructions[0]).toEqual({ kind: 'capturePlayer', player: { kind: 'relatedPlayer', relation: 'controller', of: { kind: 'targetRef', clauseIndex: 0 } }, bindResult: 'targetController' })
    expect(ability.instructions.at(-1)).toEqual(expect.objectContaining({ targets: { kind: 'resultRef', binding: 'targetController', field: 'player' } }))
    switch (name) {
      case "An Offer You Can't Refuse":
        expect(ability.decisions.targets[0]?.filter).toEqual({ kind: 'stackItems', filter: { kind: 'spell', not: { type: 'Creature' } } })
        expect(ability.instructions.at(-1)).toEqual(expect.objectContaining({ count: { kind: 'constant', value: 2 }, token: { name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'], colors: [] } }))
        break
      case 'Swan Song':
        expect(ability.decisions.targets[0]?.filter).toEqual({ kind: 'stackItems', filter: { kind: 'spell', any: [{ type: 'Enchantment' }, { type: 'Instant' }, { type: 'Sorcery' }] } })
        expect(ability.instructions.at(-1)).toEqual(expect.objectContaining({ token: expect.objectContaining({ colors: ['U'], power: 2, toughness: 2, oracleText: 'Flying' }) }))
        break
      case 'Swords to Plowshares':
        expect(ability.instructions[2]).toEqual(expect.objectContaining({ kind: 'move', to: 'exile' }))
        break
      case 'Condemn':
        expect(ability.decisions.targets[0]?.filter).toEqual({ kind: 'objects', filter: { zone: 'battlefield', type: 'Creature', attacking: true } })
        expect(ability.instructions[2]).toEqual(expect.objectContaining({ kind: 'move', to: 'library', position: 'bottom' }))
        break
    }
  }
})

test('catalog Fractured Identity captures a copy snapshot before exile', () => {
  expect(effectsFor('Fractured Identity')).toEqual([])
  const ability = cardRuleDefinitionSnapshotFor('Fractured Identity')!.definition.abilities[0]!
  if (ability.kind !== 'spell' || !ability.instructions) throw new Error('expected spell instructions')
  expect(ability.decisions.targets[0]?.filter).toEqual({ kind: 'objects', filter: { zone: 'battlefield', not: { type: 'Land' } } })
  expect(ability.instructions.map(instruction => instruction.kind)).toEqual(['captureCopy', 'capturePlayer', 'move', 'copy'])
  expect(ability.instructions[0]).toEqual({ kind: 'captureCopy', targets: { kind: 'targetRef', clauseIndex: 0 }, bindResult: 'copied' })
  expect(ability.instructions[3]).toEqual(expect.objectContaining({ kind: 'copy', snapshot: 'copied' }))
})

test('catalog Settle the Wreckage searches basics for the actual exile count', () => {
  expect(effectsFor('Settle the Wreckage')).toEqual([])
  const ability = cardRuleDefinitionSnapshotFor('Settle the Wreckage')!.definition.abilities[0]!
  if (ability.kind !== 'spell' || !ability.instructions) throw new Error('expected spell instructions')
  expect(ability.decisions.targets[0]?.filter).toEqual({ kind: 'players', filter: { relation: 'any' } })
  expect(ability.instructions[0]).toEqual(expect.objectContaining({ kind: 'move', to: 'exile', bindResult: 'exiled' }))
  expect(ability.instructions[1]).toEqual(expect.objectContaining({ kind: 'sequence' }))
})

test('catalog Terastodon destroys up to three noncreatures then tokens their controllers', () => {
  expect(effectsFor('Terastodon')).toEqual([])
  const ability = cardRuleDefinitionSnapshotFor('Terastodon')!.definition.abilities[0]!
  if (ability.kind !== 'triggered' || !ability.instructions) throw new Error('expected triggered instructions')
  expect(ability.decisions.targets[0]).toEqual(expect.objectContaining({
    filter: { kind: 'objects', filter: { zone: 'battlefield', not: { type: 'Creature' } } },
  }))
  expect(ability.instructions.map(instruction => instruction.kind)).toEqual(['destroy', 'forEach'])
  expect(ability.instructions[0]).toEqual(expect.objectContaining({ kind: 'destroy', bindChoice: 'destroyed' }))
})
