import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { allHandlerIds, handlerIdsForNames } from './cardRules'
import {
  cardPluginEntry,
  missingCardPlugins,
} from './index'

describe('card plugin registry', () => {
  test('every registered handler is a module the live host can load', () => {
    for (const handlerId of allHandlerIds()) {
      expect(handlerId).toMatch(/^[a-z][a-zA-Z0-9-]*$/)
      expect(existsSync(join(import.meta.dir, `${handlerId}.ts`))).toBe(true)
    }
  })

  test('a forest table does not load the whole handler catalog', () => {
    expect(handlerIdsForNames(['Forest'])).toEqual([])
    expect(handlerIdsForNames(['Field of the Dead'])).toEqual(['entersTapped'])
    expect(allHandlerIds().length).toBeGreaterThan(handlerIdsForNames(['Forest', 'Sol Ring']).length)
  })
  test('the Sin Fall cards this pass covers stay registered', () => {
    const covered = [
      'Aesi, Tyrant of Gyre Strait',
      'Farseek',
      'Field of the Dead',
      'Icetill Explorer',
      'Misty Rainforest',
      "Nature's Lore",
      'Riveteers Overlook',
      'Scute Swarm',
      "Sin, Spira's Punishment",
      'Zagoth Triome',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardPluginEntry('Field of the Dead')?.handlerIds)
      .toEqual(['entersTapped'])
    expect(cardPluginEntry("Sin, Spira's Punishment")?.handlerIds)
      .toEqual(['randomExileCopy'])
  })

  test('the Homer commander is registered', () => {
    expect(missingCardPlugins(['Deathsprout', 'Homer, the Hermit', 'Keep Safe'])).toEqual([])
    expect(cardPluginEntry('Homer, the Hermit')?.handlerIds).toEqual(['homer'])
  })

  test('the Homer dumpster cards this pass covers stay registered', () => {
    const covered = [
      'Homer, the Hermit',
      'Sakashima of a Thousand Faces',
      'Spark Double',
      "Irenicus's Vile Duplication",
      'Springheart Nantuko',
      'Yarok, the Desecrated',
      'Harrow',
      'Scapeshift',
      'Hedge Shredder',
      'Watery Grave',
      'Simic Growth Chamber',
      'Maskwood Nexus',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
  })

  test('every surveil land carries its enter trigger, not just its tap', () => {
    const surveilLands = [
      'Hedge Maze',
      'Shadowy Backstreet',
      'Undercity Sewers',
      'Underground Mortuary',
    ]
    expect(missingCardPlugins(surveilLands)).toEqual([])
    for (const land of surveilLands) {
      expect(cardPluginEntry(land)?.handlerIds.toSorted())
        .toEqual(['choiceEffects', 'entersTapped'])
    }
  })

  test('the Eva and Sygg enter-tapped cards are registered', () => {
    expect(missingCardPlugins([
      'Charcoal Diamond',
      'Choked Estuary',
      'Drowned Catacomb',
      'Eclipsed Steppe',
      'Glacial Fortress',
      'Godless Shrine',
      'Hallowed Fountain',
      'Mistvault Bridge',
      'Morphic Pool',
      'Orzhov Basilica',
      "Raffine's Tower",
      'Shadowy Backstreet',
      'Sky Diamond',
      'Sunken Hollow',
      'Temple of Deceit',
    ])).toEqual([])
  })

  test('Lady Evangela damage and mana cards only register card-specific rules', () => {
    for (const generic of [
      'Adarkar Wastes',
      'Arcane Signet',
      'Caves of Koilos',
      'Command Tower',
      'Underground River',
    ]) {
      expect(cardPluginEntry(generic)).toBeUndefined()
    }

    expect(cardPluginEntry("Bender's Waterskin")).toMatchObject({
      pluginIds: ['extraUntap'],
      handlerIds: [],
    })
    expect(cardPluginEntry('Souls of the Faultless')).toMatchObject({
      pluginIds: [],
      handlerIds: [],
    })
  })

  test('the Lady Evangela mana and extort cards stay registered', () => {
    expect(missingCardPlugins([
      'Crypt Ghast',
      'Exotic Orchard',
      'Nirkana Revenant',
      'Reflecting Pool',
    ])).toEqual([])
    expect(cardPluginEntry('Crypt Ghast')?.handlerIds).toContain('extort')
    expect(cardPluginEntry('Nirkana Revenant')?.handlerIds).toContain('activated')
  })

  test('the Lady Evangela alternate and replacement cards stay registered', () => {
    expect(missingCardPlugins([
      "Dovin's Veto",
      'Mulldrifter',
      'Phial of Galadriel',
      'Snuff Out',
      'Wall of Shards',
    ])).toEqual([])
    expect(cardPluginEntry('Mulldrifter')?.handlerIds).toEqual(['alternateCosts'])
    expect(cardPluginEntry('Wall of Shards')?.handlerIds).toEqual(['cumulativeUpkeep'])
  })

  test('Courser of Kruphix is registered', () => {
    expect(missingCardPlugins(['Courser of Kruphix'])).toEqual([])
    expect(cardPluginEntry('Courser of Kruphix')?.handlerIds).toEqual(['courserOfKruphix'])
  })

  test('the Círdan Show Me What You Got cards this pass covers stay registered', () => {
    const covered = [
      'Círdan the Shipwright',
      'Show and Tell',
      'Eureka',
      'Hypergenesis',
      'Braids, Conjurer Adept',
      'Reins of Power',
      'Apex Altisaur',
      'Triangle of War',
      'Concordant Crossroads',
      'Reliquary Tower',
      'Illusion of Choice',
      "An Offer You Can't Refuse",
      'Beast Whisperer',
      'Bushwhack',
      'Cultivate',
      'Decisive Denial',
      'End-Raze Forerunners',
      'Farhaven Elf',
      "Kodama's Reach",
      'Overwhelming Stampede',
      'Pathbreaker Ibex',
      'Return of the Wildspeaker',
      'Silverback Elder',
      'Twincast',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardPluginEntry('Cultivate')?.handlerIds).toContain('librarySearch')
    expect(cardPluginEntry('Bushwhack')?.handlerIds).toContain('modalSpell')
    expect(cardPluginEntry('Beast Whisperer')?.handlerIds).toContain('castTriggers')
    expect(cardPluginEntry('Twincast')?.handlerIds).toEqual(['targetedResolve', 'stackCopy'])
    expect(cardPluginEntry('Rankle, Master of Pranks')?.handlerIds)
      .toEqual(['modalSpell', 'choiceEffects'])
  })

  test('the Lady Evangela copy-politics group stays registered', () => {
    const covered = [
      'Rings of Brighthearth',
      "Council's Judgment",
      'Fractured Identity',
      'Mirrorweave',
      'Standard Bearer',
      'Sokrates, Athenian Teacher',
      'Tenuous Truce',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardPluginEntry('Rings of Brighthearth')?.handlerIds).toContain('stackCopy')
    expect(cardPluginEntry("Council's Judgment")?.handlerIds).toContain('vote')
    expect(cardPluginEntry('Standard Bearer')?.handlerIds).toContain('targetingRequirements')
    expect(cardPluginEntry('Sokrates, Athenian Teacher')?.handlerIds)
      .toEqual(expect.arrayContaining(['activated', 'combatDialogue', 'targetingRequirements']))
    expect(cardPluginEntry('Tenuous Truce')?.handlerIds).toContain('attackDeal')
  })
})
