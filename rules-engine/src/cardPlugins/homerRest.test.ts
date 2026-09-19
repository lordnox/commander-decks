import { describe, expect, test } from 'bun:test'
import { commanderRules } from '../formats'
import { cardTemplate } from '../newGame'
import { createServerGame as createRuntimeGame } from '../runtime'
import { ok, resolveStack } from '../testHelpers'
import { DIALOG_CHOSEN, dialogCandidates, pendingDialog } from '../pendingDialog'
import { pendingSelectionFor } from '../rules/selectCards'
import { choiceEffects } from './choiceEffects'
import { entersTapped } from './entersTapped'
import { librarySearch, pendingSearch } from './librarySearch'
import { onResolve } from './onResolve'
import { targetedResolve } from './targetedResolve'
import { activated } from './activated'

const createServerGame: typeof createRuntimeGame = (format, options) =>
  createRuntimeGame(format, options, {
    random: () => 0.5,
    cardPlugins: [
      choiceEffects,
      entersTapped,
      librarySearch,
      onResolve,
      targetedResolve,
      activated,
    ],
  })

const named = (state: import('../types').GameState, name: string) =>
  Object.values(state.objects).find((object) => object.name === name)!

describe('Homer remaining card plugins', () => {
  test('Harrow sacrifices a land and opens a two-basic search', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Harrow', { types: ['Instant'], manaCost: '{2}{G}' })] },
        battlefield: {
          p1: [cardTemplate('Forest', {
            types: ['Land'],
            subtypes: ['Forest'],
            supertypes: ['Basic'],
          })],
        },
        libraries: {
          p1: [
            cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'], supertypes: ['Basic'] }),
            cardTemplate('Island', { types: ['Land'], subtypes: ['Island'], supertypes: ['Basic'] }),
          ],
        },
      },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 }
    const land = ready.zoneOrder.p1.battlefield[0]
    const opened = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Harrow').id,
      sacrifice: [land],
    }))
    expect(opened.objects[land].zone).toBe('graveyard')
    const searching = ok(server.rules(opened, { type: 'resolveTop' }))
    expect(pendingSearch(searching, 'p1')?.source).toBe('Harrow')
    expect(pendingSearch(searching, 'p1')?.max).toBeUndefined()
  })

  test('a bounce land asks which land to return', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Simic Growth Chamber', { types: ['Land'] })] },
        battlefield: {
          p1: [cardTemplate('Forest', { types: ['Land'], subtypes: ['Forest'] })],
        },
      },
    )
    const entered = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: named(server.state, 'Simic Growth Chamber').id,
    })))
    expect(pendingDialog(entered)?.kind).toBe('bounce-land')
    expect(named(entered, 'Simic Growth Chamber').tapped).toBe(true)
  })

  test('Sakashima copies another creature and turns off the legend rule', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [
            cardTemplate('Homer, the Hermit', {
              types: ['Creature'],
              subtypes: ['Crab'],
              supertypes: ['Legendary'],
            }),
          ],
        },
        hands: {
          p1: [
            cardTemplate('Sakashima of a Thousand Faces', {
              types: ['Creature'],
              subtypes: ['Human', 'Rogue'],
              supertypes: ['Legendary'],
            }),
          ],
        },
      },
    )
    const moved = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'move',
      objectId: named(server.state, 'Sakashima of a Thousand Faces').id,
      to: 'battlefield',
    })))
    const sakashima = named(moved, 'Sakashima of a Thousand Faces')
    expect(pendingDialog(moved)?.kind).toBe('copy-creature')
    const copied = ok(server.rules(moved, {
      type: 'custom',
      name: DIALOG_CHOSEN,
      seat: 'p1',
      payload: { objectIds: [named(moved, 'Homer, the Hermit').id] },
    }))
    const clone = copied.objects[sakashima.id]
    expect(clone.name).toBe('Sakashima of a Thousand Faces')
    expect(clone.subtypes).toContain('Crab')
    expect(copied.zoneOrder.p1.battlefield).toHaveLength(2)
  })

  test('an opponent-owned clone entering under your control copies your creature', () => {
    const server = createServerGame(
      commanderRules,
      {
        battlefield: {
          p1: [cardTemplate('Sygg, River Cutthroat', { types: ['Creature'] })],
          p2: [cardTemplate('Homer, the Hermit', { types: ['Creature'] })],
        },
        hands: {
          p2: [cardTemplate('Spark Double', {
            types: ['Creature'],
            power: 0,
            toughness: 0,
          })],
        },
      },
    )
    const spark = named(server.state, 'Spark Double')
    const buried = ok(server.rules(server.state, {
      type: 'move',
      objectId: spark.id,
      to: 'graveyard',
    }))
    const entered = resolveStack(server.rules, ok(server.rules(buried, {
      type: 'move',
      objectId: spark.id,
      to: 'battlefield',
      controller: 'p1',
    })))
    const dialog = pendingDialog(entered)
    expect(entered.objects[spark.id].controller).toBe('p1')
    expect(entered.objects[spark.id].zone).toBe('battlefield')
    expect(dialog?.seat).toBe('p1')
    expect(dialogCandidates(entered, dialog!).map((object) => object.name)).toEqual([
      'Sygg, River Cutthroat',
    ])
  })

  test('Yarok makes landfall happen an extra time for Aesi', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Forest', { types: ['Land'] })] },
        battlefield: {
          p1: [
            cardTemplate('Aesi, Tyrant of Gyre Strait', { types: ['Creature'] }),
            cardTemplate('Yarok, the Desecrated', { types: ['Creature'] }),
          ],
        },
        libraries: {
          p1: [
            cardTemplate('First', { types: ['Instant'] }),
            cardTemplate('Second', { types: ['Instant'] }),
          ],
        },
      },
    )
    const next = resolveStack(server.rules, ok(server.rules(server.state, {
      type: 'playLand',
      seat: 'p1',
      objectId: named(server.state, 'Forest').id,
    })))
    expect(next.zoneOrder.p1.hand.map((id) => next.objects[id].name)).toEqual(['First', 'Second'])
  })

  test('Harrow cannot be cast without sacrificing a land', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Harrow', { types: ['Instant'], manaCost: '{2}{G}' })] },
      },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana.G = 3
    const result = server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(ready, 'Harrow').id,
    })
    expect(result.ok).toBe(false)
  })

  test('Join the Dead uses descend 4 for its full penalty', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Join the Dead', { types: ['Instant'] })] },
        battlefield: {
          p2: [cardTemplate('Target', { types: ['Creature'], power: 10, toughness: 10 })],
        },
        libraries: {
          p1: [
            cardTemplate('Land', { types: ['Land'], zone: 'graveyard' }),
            cardTemplate('Creature', { types: ['Creature'], zone: 'graveyard' }),
            cardTemplate('Artifact', { types: ['Artifact'], zone: 'graveyard' }),
            cardTemplate('Enchantment', { types: ['Enchantment'], zone: 'graveyard' }),
          ],
        },
      },
    )
    const spell = named(server.state, 'Join the Dead')
    const target = named(server.state, 'Target')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[target.id].zone).toBe('graveyard')
  })

  test('Stitch Together changes destination at threshold', () => {
    const graveyard = [
      cardTemplate('Returned', { types: ['Creature'], zone: 'graveyard' }),
      ...Array.from({ length: 6 }, (_, index) =>
        cardTemplate(`Grave ${index}`, { types: ['Instant'], zone: 'graveyard' })),
    ]
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Stitch Together', { types: ['Sorcery'] })] },
        libraries: { p1: graveyard },
      },
    )
    const spell = named(server.state, 'Stitch Together')
    const target = named(server.state, 'Returned')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[target.id].zone).toBe('battlefield')
  })

  test('Black Sun’s Twilight scales with X and reanimates tapped at five', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: {
          p1: [cardTemplate('Black Sun\'s Twilight', {
            types: ['Instant'],
            manaCost: '{X}{B}',
          })],
        },
        battlefield: {
          p2: [cardTemplate('Target', { types: ['Creature'], power: 6, toughness: 6 })],
        },
        libraries: {
          p1: [cardTemplate('Returned', {
            types: ['Creature'],
            manaValue: 4,
            zone: 'graveyard',
          })],
        },
      },
    )
    const ready = structuredClone(server.state)
    ready.players.p1.mana = { W: 0, U: 0, B: 6, R: 0, G: 0, C: 0 }
    const spell = named(ready, 'Black Sun\'s Twilight')
    const target = named(ready, 'Target')
    const returned = named(ready, 'Returned')
    const cast = ok(server.rules(ready, {
      type: 'castSpell',
      seat: 'p1',
      objectId: spell.id,
      x: 5,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    expect(choosing.objects[target.id]).toMatchObject({ power: 1, toughness: 1 })
    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: selection.count,
      objectIds: [returned.id],
    }))
    expect(resolved.objects[returned.id]).toMatchObject({
      zone: 'battlefield',
      tapped: true,
    })
  })

  test('Malevolent Rumble creates a functional Eldrazi Spawn', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Malevolent Rumble', { types: ['Sorcery'] })] },
        libraries: {
          p1: [
            cardTemplate('Permanent', { types: ['Artifact'] }),
            cardTemplate('One', { types: ['Instant'] }),
            cardTemplate('Two', { types: ['Instant'] }),
            cardTemplate('Three', { types: ['Instant'] }),
          ],
        },
      },
    )
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Malevolent Rumble').id,
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    const spawn = named(resolved, 'Eldrazi Spawn')
    expect(spawn).toMatchObject({
      types: ['Creature'],
      subtypes: ['Eldrazi', 'Spawn'],
      power: 0,
      toughness: 1,
    })
    const sacrificed = ok(server.rules(resolved, {
      type: 'activateAbility',
      abilityId: 'token.sacrifice-for-mana',
      seat: 'p1',
      objectId: spawn.id,
      manaAbility: true,
    }))
    expect(sacrificed.objects[spawn.id].zone).toBe('graveyard')
    expect(sacrificed.players.p1.mana.C).toBe(1)
  })

  test('Fell the Profane destroys and drains the target’s controller', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Fell the Profane', { types: ['Instant'] })] },
        battlefield: {
          p2: [cardTemplate('Target', { types: ['Creature'], power: 2, toughness: 2 })],
        },
      },
    )
    const target = named(server.state, 'Target')
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Fell the Profane').id,
      targets: [{ kind: 'object', objectId: target.id }],
    }))
    const resolved = ok(server.rules(cast, { type: 'resolveTop' }))
    expect(resolved.objects[target.id].zone).toBe('graveyard')
    expect(resolved.players.p2.life).toBe(38)
  })

  test('Incarnation Technique reanimates a creature rather than a land', () => {
    const server = createServerGame(
      commanderRules,
      {
        hands: { p1: [cardTemplate('Incarnation Technique', { types: ['Sorcery'] })] },
        libraries: {
          p1: [
            cardTemplate('Body', { types: ['Creature'], zone: 'graveyard' }),
            cardTemplate('Land', { types: ['Land'], zone: 'graveyard' }),
            ...Array.from({ length: 5 }, (_, index) =>
              cardTemplate(`Milled ${index}`, { types: ['Instant'] })),
          ],
        },
      },
    )
    const cast = ok(server.rules(server.state, {
      type: 'castSpell',
      seat: 'p1',
      objectId: named(server.state, 'Incarnation Technique').id,
    }))
    const choosing = ok(server.rules(cast, { type: 'resolveTop' }))
    const selection = pendingSelectionFor(choosing, 'p1')!
    expect(selection.candidates).toEqual([named(choosing, 'Body').id])
    const resolved = ok(server.rules(choosing, {
      type: 'selectCards',
      seat: 'p1',
      kind: 'choose',
      count: 1,
      objectIds: selection.candidates,
    }))
    expect(named(resolved, 'Body').zone).toBe('battlefield')
    expect(named(resolved, 'Land').zone).toBe('graveyard')
  })
})
