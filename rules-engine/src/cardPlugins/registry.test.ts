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
    expect(handlerIdsForNames(['Field of the Dead'])).toEqual(['entersTapped', 'landfall'])
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
      .toEqual(['entersTapped', 'landfall'])
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
    expect(cardPluginEntry('Twincast')?.handlerIds).toEqual(['targetedResolve', 'copySpell'])
  })
})
