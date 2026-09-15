import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import registry from '../../../cards/rules-plugins.json'
import { cardPlugins, cardPluginEntry, missingCardPlugins } from './index'
import type { CardPluginEntry } from './index'

const entries = Object.values(registry as Record<string, CardPluginEntry>)
const handlerIds = [...new Set(entries.flatMap((entry) => entry.handlerIds ?? []))]

describe('card plugin registry', () => {
  test('every registered handler is a module the live host can load', () => {
    for (const handlerId of handlerIds) {
      expect(handlerId).toMatch(/^[a-z][a-zA-Z0-9-]*$/)
      expect(existsSync(join(import.meta.dir, `${handlerId}.ts`))).toBe(true)
    }
  })

  test('the always-on land and search handlers are built into every new game', () => {
    const built = new Set(cardPlugins.map((plugin) => plugin.id))
    for (const handlerId of [
      'additionalLandPlay',
      'entersTapped',
      'landfall',
      'librarySearch',
    ]) {
      expect(built.has(handlerId)).toBe(true)
    }
  })

  test('the Sin Fall cards this pass covers stay registered', () => {
    const covered = [
      'Aesi, Tyrant of Gyre Strait',
      'Farseek',
      'Field of the Dead',
      'Icetill Explorer',
      'Misty Rainforest',
      "Nature's Lore",
      'Scute Swarm',
      "Sin, Spira's Punishment",
      'Zagoth Triome',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardPluginEntry('Field of the Dead')?.handlerIds)
      .toEqual(['entersTapped', 'landfall'])
  })

  test('the Homer commander is registered', () => {
    expect(missingCardPlugins(['Homer, the Hermit'])).toEqual([])
    expect(cardPluginEntry('Homer, the Hermit')?.handlerIds).toEqual(['homer'])
  })

  test('a card nobody has plugged is still reported as missing', () => {
    expect(missingCardPlugins(['Springheart Nantuko'])).toEqual([
      'Springheart Nantuko',
    ])
  })
})
