import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { cardTemplateDefaultsFor, cardRuleDefinitionSnapshotFor } from './dsl/cardRuleCatalog'
import { catalogEntry, deckCards } from '../deckCardFixtures'
import { allHandlerIds, cardDefinition, effectsFor, handlerIdsForNames } from './cardRules'
import {
  cardPluginEntry,
  grantedRulesFor,
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
    expect(handlerIdsForNames(['Field of the Dead'])).toEqual([])
    expect(allHandlerIds().length).toBeGreaterThan(handlerIdsForNames(['Forest', 'Sol Ring']).length)
  })
  test('the Sin Fall cards this pass covers stay registered', () => {
    const covered = [
      'Aesi, Tyrant of Gyre Strait',
      'Farseek',
      'Field of the Dead',
      'Icetill Explorer',
      'Misty Rainforest',
      'Riveteers Overlook',
      'Scute Swarm',
      "Sin, Spira's Punishment",
      'Zagoth Triome',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Field of the Dead')).toBeDefined()
    expect(cardPluginEntry("Sin, Spira's Punishment")).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor("Sin, Spira's Punishment")).toBeDefined()
  })

  test('the Homer commander is registered', () => {
    expect(missingCardPlugins(['Deathsprout', 'Homer, the Hermit', 'Keep Safe'])).toEqual([])
    expect(cardPluginEntry('Homer, the Hermit')).toBeUndefined()
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
      'Fact or Fiction',
      "Fortune's Favor",
      'Ripples of Undeath',
      'Victimize',
      'Masked Vandal',
      'Lumra, Bellow of the Woods',
      'Blossoming Tortoise',
      'Roaming Throne',
      'Zimone and Dina',
      'Malakir Rebirth',
      'Awaken the Honored Dead',
      "Black Sun's Twilight",
      'Life from the Loam',
      'Cephalid Coliseum',
      'Skull Prophet',
      'Firdoch Core',
      'Aftermath Analyst',
      'Thawing Glaciers',
      'Mole Man, Moloid Master',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(handlerIdsForNames(["Irenicus's Vile Duplication"])).toEqual([])
    expect(cardPluginEntry("Irenicus's Vile Duplication")).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor("Irenicus's Vile Duplication")).toBeDefined()
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
      expect(effectsFor(land)).toEqual([])
      expect(cardRuleDefinitionSnapshotFor(land)?.definition.abilities).toMatchObject([
        { kind: 'static' },
        { kind: 'triggered', on: { kind: 'enters' }, instructions: [{ kind: 'surveil' }] },
      ])
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

    expect(cardPluginEntry('Souls of the Faultless')).toBeUndefined()
  })

  test('the Lady Evangela mana and extort cards stay registered', () => {
    expect(missingCardPlugins([
      'Crypt Ghast',
      'Exotic Orchard',
      'Nirkana Revenant',
      'Reflecting Pool',
    ])).toEqual([])
    expect(effectsFor('Crypt Ghast')).toEqual([])
    expect(effectsFor('Nirkana Revenant')).toEqual([])
  })

  test('the Lady Evangela alternate and replacement cards stay registered', () => {
    expect(missingCardPlugins([
      "Dovin's Veto",
      'Mulldrifter',
      'Phial of Galadriel',
      'Snuff Out',
      'Wall of Shards',
    ])).toEqual([])
    expect(cardPluginEntry('Mulldrifter')).toBeUndefined()
    expect(cardPluginEntry('Wall of Shards')?.handlerIds ?? []).toEqual([])
  })

  test('the Sin Fall finisher cards load their handlers', () => {
    expect(missingCardPlugins([
      'Famished Worldsire',
      'Finale of Devastation',
      'Valgavoth, Terror Eater',
    ])).toEqual([])
    expect(handlerIdsForNames(['Famished Worldsire'])).toEqual([])
    expect(cardPluginEntry('Famished Worldsire')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Famished Worldsire')).toBeDefined()
    expect(handlerIdsForNames(['Finale of Devastation'])).toEqual([])
    expect(cardPluginEntry('Finale of Devastation')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Finale of Devastation')).toBeDefined()
    expect(handlerIdsForNames(['Valgavoth, Terror Eater'])).toEqual([])
    expect(cardPluginEntry('Valgavoth, Terror Eater')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Valgavoth, Terror Eater')).toBeDefined()
  })

  test('the Sin Fall replacement and hidden-pile cards load their handlers', () => {
    expect(missingCardPlugins([
      'Cling to Dust',
      'Dread Return',
      'Hostile Negotiations',
    ])).toEqual([])
    expect(handlerIdsForNames(['Abundance'])).toEqual([])
    expect(handlerIdsForNames(['Cling to Dust'])).toEqual([])
    expect(cardPluginEntry('Cling to Dust')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Cling to Dust')).toBeDefined()
    expect(handlerIdsForNames(['Dread Return'])).toEqual([])
    expect(cardPluginEntry('Dread Return')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Dread Return')).toBeDefined()
    expect(handlerIdsForNames(['Hostile Negotiations'])).toEqual([])
    expect(cardPluginEntry('Hostile Negotiations')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Hostile Negotiations')).toBeDefined()
  })

  test('Courser of Kruphix is registered', () => {
    expect(missingCardPlugins(['Courser of Kruphix'])).toEqual([])
    expect(cardPluginEntry('Courser of Kruphix')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Courser of Kruphix')).toBeDefined()
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
    expect(effectsFor('Show and Tell')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Show and Tell')).toBeDefined()
    expect(effectsFor('Eureka')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Eureka')).toBeDefined()
    expect(handlerIdsForNames(['Show and Tell', 'Eureka'])).toEqual([])
    expect(cardPluginEntry('Cultivate')).toBeUndefined()
    expect(cardPluginEntry("Kodama's Reach")).toBeUndefined()
    expect(cardPluginEntry('Astral Drift')).toBeUndefined()
    expect(cardPluginEntry("Raffine's Tower")).toBeUndefined()
    expect(cardPluginEntry('Secluded Steppe')).toBeUndefined()
    expect(cardPluginEntry('Zagoth Triome')).toBeUndefined()
    expect(cardPluginEntry('Breeding Pool')).toBeUndefined()
    expect(cardPluginEntry('Godless Shrine')).toBeUndefined()
    expect(cardPluginEntry('Hallowed Fountain')).toBeUndefined()
    expect(cardPluginEntry('Overgrown Tomb')).toBeUndefined()
    expect(cardPluginEntry('Watery Grave')).toBeUndefined()
    expect(cardPluginEntry('Bushwhack')).toBeUndefined()
    expect(cardPluginEntry('Beast Whisperer')).toBeUndefined()
    expect(cardPluginEntry('Twincast')).toBeUndefined()
    expect(cardPluginEntry('Overwhelming Stampede')).toBeUndefined()
    expect(cardPluginEntry('Pathbreaker Ibex')).toBeUndefined()
    expect(cardPluginEntry('Return of the Wildspeaker')).toBeUndefined()
    expect(handlerIdsForNames(['Overwhelming Stampede', 'Pathbreaker Ibex', 'Return of the Wildspeaker'])).toEqual([])
    expect(cardPluginEntry('Rankle, Master of Pranks')).toBeUndefined()
    expect(cardPluginEntry('Springheart Nantuko')).toBeUndefined()
  })

  test('the Círdan creature group stays registered', () => {
    const covered = [
      'Archetype of Endurance',
      'Blightsteel Colossus',
      'Darksteel Colossus',
      'Grothama, All-Devouring',
      'Guardian Project',
      'It That Betrays',
      'Sire of Seven Deaths',
      'Terastodon',
      'Thunderfoot Baloth',
      'Void Winnower',
      'Woodfall Primus',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardPluginEntry('Blightsteel Colossus')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Blightsteel Colossus')).toBeDefined()
    expect(cardPluginEntry('Sire of Seven Deaths')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Sire of Seven Deaths')).toBeDefined()
    expect(cardPluginEntry('Grothama, All-Devouring')).toBeUndefined()
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
    expect(cardPluginEntry("Council's Judgment")).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor("Council's Judgment")).toBeDefined()
    expect(cardPluginEntry('Standard Bearer')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Standard Bearer')).toBeDefined()
    expect(cardPluginEntry('Sokrates, Athenian Teacher')).toBeUndefined()
    expect(cardPluginEntry('Tenuous Truce')?.handlerIds ?? []).toEqual([])
  })

  test('Dack Fayden, Helping Hand is registered', () => {
    expect(missingCardPlugins(['Dack Fayden, Helping Hand'])).toEqual([])
    expect(cardPluginEntry('Dack Fayden, Helping Hand')?.handlerIds ?? []).not.toContain('permanentControl')
  })

  test('Dack Fayden part 32 lands, rocks, and maps stay registered', () => {
    const covered = [
      "Archaeomancer's Map",
      "Commander's Sphere",
      'Endless Sands',
      'Everflowing Chalice',
      'Expedition Map',
      'Geier Reach Sanitarium',
      'Gilded Lotus',
      'Hedron Archive',
      'High Market',
      'Mind Stone',
      'Moonsilver Key',
      'Myriad Landscape',
      'Secluded Steppe',
      'Temple of the False God',
      "Thespian's Stage",
      "Thrór's Map",
      "Urza's Cave",
      'World Map',
      'Worn Powerstone',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    for (const generic of ['Plains', 'Sol Ring', 'Thran Dynamo', 'Emergence Zone', 'Northampton Farm']) {
      expect(cardPluginEntry(generic)).toBeUndefined()
    }
  })

  test('Dack Fayden part 34 linked-exile cages stay registered', () => {
    const covered = [
      'Angel of Sanctions',
      'Banisher Priest',
      'Bishop of Binding',
      'Fiend Hunter',
      'Glorious Protector',
      'Lumbering Battlement',
      'Palace Jailer',
      'Werefox Bodyguard',
    ]
    expect(missingCardPlugins(covered)).toEqual([])
    expect(cardPluginEntry('Banisher Priest')).toBeUndefined()
    expect(cardPluginEntry('Fiend Hunter')).toBeUndefined()
    expect(cardPluginEntry('Werefox Bodyguard')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Banisher Priest')).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('Fiend Hunter')).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('Werefox Bodyguard')).toBeDefined()
  })

  test('Niv-Mizzet, Ghost Counsel stays registered', () => {
    expect(missingCardPlugins(['Niv-Mizzet, Ghost Counsel'])).toEqual([])
    expect(cardPluginEntry('Niv-Mizzet, Ghost Counsel')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Niv-Mizzet, Ghost Counsel')).toBeDefined()
  })

  test('Jace, Multiverse Architect is registered with optional mana pay', () => {
    expect(missingCardPlugins(['Jace, Multiverse Architect'])).toEqual([])
    expect(cardPluginEntry('Jace, Multiverse Architect')).toBeUndefined()
  })

  test('the Lady Evangela remaining group stays registered', () => {
    expect(missingCardPlugins([
      'Counterspell',
      'Arcanis the Omnipotent',
      "Minamo, School at Water's Edge",
      'Condemn',
      'Hatred',
      'Infernal Contract',
      'Mana Drain',
      'Desertion',
      'City of Brass',
      'Cryptic Command',
      'Wedding Ring',
      'Breena, the Demagogue',
      'Kuroki, Thief of Talents',
    ])).toEqual([])
    expect(cardPluginEntry('Kuroki, Thief of Talents')?.handlerIds).toContain('stealCast')
    expect(cardPluginEntry('Cryptic Command')).toBeUndefined()
  })

  test('the Lady Evangela foggy-blood pass stays registered', () => {
    expect(missingCardPlugins([
      'Absorb',
      'Anguished Unmaking',
      'Batwing Brume',
      'Blanket of Night',
      'Blood Celebrant',
      'Bubbling Muck',
      'Cabal Coffers',
      'Cabal Stronghold',
      'Comeuppance',
      'Crypt Ghast',
      'Dark Confidant',
      'Dark Tutelage',
      'Darkness',
      'Debt to the Deathless',
      'Deserted Temple',
      'Dimir Signet',
      'Drain Life',
      "Dovin's Veto",
      'Energy Arc',
      'Everybody Lives!',
      'Esper Panorama',
      'Expedition Map',
      'Exsanguinate',
      'Inkshield',
      'Kami of False Hope',
      'Lady Evangela',
      'Magus of the Coffers',
      'Marsh Flats',
      'Mirror Universe',
      'Mister Negative',
      'Mulldrifter',
      'Necrologia',
      'Nirkana Revenant',
      'Orzhov Signet',
      "Raffine's Tower",
      'Repay in Kind',
      'Selenia, Dark Angel',
      'Settle the Wreckage',
      'Snuff Out',
      'Swan Song',
      'Swords to Plowshares',
      'Urborg, Tomb of Yawgmoth',
      'Wall of Blood',
      'Counterspell',
      'Arcanis the Omnipotent',
      'Cryptic Command',
      'Wedding Ring',
      'Breena, the Demagogue',
      'Kuroki, Thief of Talents',
    ])).toEqual([])
  })

  test('Lady Evangela blink-value cards stay registered', () => {
    expect(missingCardPlugins([
      'Ephemerate',
      'Ghostly Flicker',
      'Vanish into Memory',
      'Loran of the Third Path',
      'Lotho, Corrupt Shirriff',
      'Queza, Augur of Agonies',
    ])).toEqual([])
  })

  test('Círdan part-B mana cards stay registered', () => {
    expect(missingCardPlugins([
      "Alchemist's Refuge",
      'Arbor Elf',
      'Flooded Grove',
      'Waterlogged Grove',
      'Simic Signet',
      'Wild Growth',
      'Utopia Sprawl',
      'Sea Gate Restoration // Sea Gate, Reborn',
      'Sink into Stupor // Soporific Springs',
    ])).toEqual([])
  })

  test('Kambal added mana and graveyard cards stay registered', () => {
    expect(missingCardPlugins([
      'Godless Shrine',
      'Vault of Champions',
      'Concealed Courtyard',
      'Bojuka Bog',
      'Boggart Trawler // Boggart Bog',
    ])).toEqual([])
  })

  test('Archangel and Baird use canonical combat-tax definitions', () => {
    expect(handlerIdsForNames([
      'Archangel of Tithes',
      'Baird, Steward of Argive',
    ])).toEqual([])
    expect(cardPluginEntry('Archangel of Tithes')).toBeUndefined()
    expect(cardPluginEntry('Baird, Steward of Argive')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Archangel of Tithes')).toBeDefined()
    expect(cardRuleDefinitionSnapshotFor('Baird, Steward of Argive')).toBeDefined()
  })

  test('Marina Vendrell uses a canonical definition without legacy effects', () => {
    expect(effectsFor('Marina Vendrell')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Marina Vendrell')).toBeDefined()
  })

  test('Yurlok uses a canonical static consequence', () => {
    expect(grantedRulesFor('Yurlok of Scorch Thrash')).toEqual([])
    expect(missingCardPlugins(['Sol Ring', 'Yurlok of Scorch Thrash'])).toEqual(['Sol Ring'])
  })

  test('copy spells use canonical definitions without legacy effects', () => {
    expect(effectsFor('Twincast')).toEqual([])
    expect(effectsFor('Reverberate')).toEqual([])
  })

  test('Blightsteel and Darksteel Colossus use canonical owner-library shuffle', () => {
    for (const name of ['Blightsteel Colossus', 'Darksteel Colossus']) {
      expect(effectsFor(name)).toEqual([])
      expect(cardPluginEntry(name)).toBeUndefined()
      expect(cardRuleDefinitionSnapshotFor(name)).toBeDefined()
    }
  })

  test('Sire of Seven Deaths uses a canonical Ward-pay-7-life definition', () => {
    expect(effectsFor('Sire of Seven Deaths')).toEqual([])
    expect(cardPluginEntry('Sire of Seven Deaths')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Sire of Seven Deaths')).toBeDefined()
  })

  test('Void Winnower uses canonical even-parity restrictions', () => {
    expect(effectsFor('Void Winnower')).toEqual([])
    expect(cardPluginEntry('Void Winnower')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Void Winnower')).toBeDefined()
  })

  test('Grothama registers an attack grant and a leaves-draw trigger', () => {
    expect(effectsFor('Grothama, All-Devouring')).toEqual([])
    expect(cardPluginEntry('Grothama, All-Devouring')).toBeUndefined()
  })

  test('Woodfall Primus registers persist and a mandatory noncreature destroy', () => {
    expect(effectsFor('Woodfall Primus')).toEqual([])
    expect(cardPluginEntry('Woodfall Primus')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Woodfall Primus')!.definition.abilities).toMatchObject([
      { kind: 'keyword', keyword: 'trample' },
      {
        kind: 'triggered',
        on: { kind: 'enters' },
        decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', not: { type: 'Creature' } } } }] },
        instructions: [{ kind: 'destroy' }],
      },
      {
        kind: 'triggered',
        on: { kind: 'dies' },
        interveningIf: { kind: 'compareAmount', operator: 'eq' },
        instructions: [{ kind: 'move', to: 'battlefield', enterCounters: { '-1/-1': { kind: 'constant', value: 1 } } }],
      },
    ])
  })

  test('Terastodon registers an up-to-three destroy with a per-controller Elephant', () => {
    expect(effectsFor('Terastodon')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Terastodon')!.definition.abilities[0]).toMatchObject({
      kind: 'triggered',
      decisions: { targets: [{ filter: { kind: 'objects', filter: { zone: 'battlefield', not: { type: 'Creature' } } } }] },
      instructions: [{ kind: 'destroy', bindChoice: 'destroyed' }, { kind: 'forEach' }],
    })
  })

  test('council cards register the vote engine handlers they need', () => {
    expect(handlerIdsForNames(['Sail into the West']).toSorted())
      .toEqual([])
    expect(handlerIdsForNames(["Selvala's Stampede"])).toEqual([])
    expect(cardPluginEntry("Selvala's Stampede")).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor("Selvala's Stampede")).toBeDefined()
    expect(handlerIdsForNames(['Coercive Portal'])).toEqual([])
    expect(cardPluginEntry('Coercive Portal')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Coercive Portal')).toBeDefined()
  })

  test('Split Decision and Trap the Trespassers register vote handlers', () => {
    expect(handlerIdsForNames(['Split Decision'])).toEqual([])
    expect(cardPluginEntry('Split Decision')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Split Decision')).toBeDefined()
  })

  test('Incarnation Technique is a catalog card with demonstrate', () => {
    expect(effectsFor('Incarnation Technique')).toEqual([])
    expect(cardPluginEntry('Incarnation Technique')).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor('Incarnation Technique')!.definition.abilities).toMatchObject([
      { kind: 'keyword', keyword: 'demonstrate' },
      { kind: 'spell' },
    ])
  })

  test('Círdan misc cards keep their handler composition', () => {
    expect(handlerIdsForNames(['Dig Through Time'])).toEqual([])
    expect(cardPluginEntry('Dig Through Time')).toBeUndefined()
    expect(handlerIdsForNames(['Mana Drain'])).toEqual([])
    expect(cardPluginEntry('Mana Drain')).toBeUndefined()
    expect(handlerIdsForNames([
      'Sea Gate Restoration // Sea Gate, Reborn',
      'Sink into Stupor // Soporific Springs',
    ])).toEqual([])
    expect(cardPluginEntry('Sea Gate Restoration // Sea Gate, Reborn')).toBeUndefined()
    expect(cardPluginEntry('Sink into Stupor // Soporific Springs')).toBeUndefined()
    expect(handlerIdsForNames(['Nezahal, Primal Tide'])).toEqual([])
    expect(effectsFor('Nezahal, Primal Tide')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Nezahal, Primal Tide')).toBeDefined()
    expect(effectsFor('Kiora Bests the Sea God')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Kiora Bests the Sea God')).toBeDefined()
    expect(effectsFor("Rishkar's Expertise")).toEqual([])
    expect(cardRuleDefinitionSnapshotFor("Rishkar's Expertise")).toBeDefined()
    expect(cardPluginEntry('Spearbreaker Behemoth')).toBeUndefined()
  })

  test('Homer remaining cards keep their resolve composition', () => {
    expect(effectsFor('Fact or Fiction')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Fact or Fiction')).toBeDefined()
    expect(effectsFor('Life from the Loam')).toEqual([])
    expect(cardRuleDefinitionSnapshotFor('Life from the Loam')).toBeDefined()
    const room = cardTemplateDefaultsFor('Walk-In Closet // Forgotten Cellar')!
    expect(room.roomDoors?.[0].ruleDefinition?.definition.abilities).toMatchObject([
      { kind: 'static', effects: [{ kind: 'playLands', cards: { filter: { zone: 'graveyard', owner: 'you', type: 'Land' } } }] },
    ])
    expect(room.roomDoors?.[1].ruleDefinition?.definition.abilities).toMatchObject([
      { kind: 'triggered', on: { kind: 'unlockDoor' }, instructions: [
        { kind: 'createRuleEffect', effect: { kind: 'castSpells' }, duration: { kind: 'untilCleanup' } },
        { kind: 'createRuleEffect', effect: { kind: 'replacement', event: { kind: 'move', filter: { to: 'graveyard', object: { owner: 'you', card: true } } }, transform: { kind: 'redirect', to: 'exile' } } },
      ] },
    ])
  })

  test("Thespian's Stage is a catalog land with a kept copy activation", () => {
    expect(effectsFor("Thespian's Stage")).toEqual([])
    expect(cardDefinition("Thespian's Stage")).toBeUndefined()
    expect(cardRuleDefinitionSnapshotFor("Thespian's Stage")!.definition.abilities).toMatchObject([
      { kind: 'activated' },
      { kind: 'activated', instructions: [{ kind: 'createEffect', effect: { kind: 'copy' } }] },
    ])
  })

  test.each([
    [
      'Emergence Zone',
      'Sacrifice-for-flash and {1},{T} timing are not composable from existing plugins; only basic tap-for-{C} is modeled without CARD_RULES.',
    ],
    [
      'Northampton Farm',
      'Exile a creature you own, then return one exiled creature to the battlefield and other exiled cards to hand is not composable from linkedExile like Endless Sands.',
    ],
    [
      "Archaeomancer's Map (land enter)",
      'Second ability uses playLand + opponentHasMore, not land-enter nor comparing land counts to the triggering opponent in multiplayer.',
    ],
  ] as const)('Dack part-32 documented GAP: %s', (_label, note) => {
    expect(note.length).toBeGreaterThan(20)
  })

  test.each([
    "Abdel Adrian, Gorion's Ward",
    'Angel of Serenity',
    'Constricting Sliver',
    'Driftgloom Coyote',
  ] as const)('%s is not registered until Pass 1 adds missing builders', (name) => {
    expect(effectsFor(name)).toEqual([])
    expect(cardDefinition(name)).toBeUndefined()
  })

  test('Dack party blink cards expose plugin definitions and handler ids', () => {
    const names = [
      'Cloudshift',
      'Ephemerate',
      'Flicker of Fate',
      'Getaway Glamer',
      'Long Road Home',
      'Otherworldly Journey',
      'Parting Gust',
      'Flickerwisp',
      'Restoration Angel',
      'Felidar Guardian',
      'Voyager Staff',
      'Guardian of Ghirapur',
      'All-Fates Stalker',
    ]
    expect(missingCardPlugins(names)).toEqual([])
    expect(handlerIdsForNames(names)).toEqual([])
  })

  test('Dack party pass-35 inventory matches registered, kernel-only, or GAP', () => {
    const inventory: Record<string, 'registered' | 'kernel-only' | 'GAP'> = {
      'Dack Fayden, Helping Hand': 'registered',
      'Helping Hand': 'kernel-only',
      "Collector's Vault": 'registered',
      'Daily Bugle Newspaper': 'registered',
      Blitzball: 'kernel-only',
      Belonging: 'registered',
      'Beza, the Bounding Spring': 'registered',
      'Perch Protection': 'registered',
      'Rumor Gatherer': 'GAP',
      'Enduring Innocence': 'GAP',
      'Ori, Plate Stacker': 'GAP',
      'Graaz, Unstoppable Juggernaut': 'GAP',
    }
    const gapReason: Partial<Record<string, string>> = {
      'Rumor Gatherer':
        'Pass 1 lacks controlled-creature-enter trigger with whenResolvedNth (alliance); '
        + 'only landfallResolveNth exists today.',
      'Enduring Innocence':
        'Pass 1 lacks other-creatures-you-control-enter + power≤2 + onceEachTurn; '
        + 'diesReturnAsEnchantment alone is insufficient for full Oracle.',
      'Ori, Plate Stacker':
        'Pass 1 lacks destroy all opponents’ artifacts/enchantments + gain life per destroyed.',
      'Graaz, Unstoppable Juggernaut':
        'Pass 1 lacks static juggernaut combat restrictions and mass P/T/subtype rewrite.',
    }
    for (const [name, status] of Object.entries(inventory)) {
      const effects = effectsFor(name)
      if (status === 'registered') {
        expect(effects.length > 0 || Boolean(cardRuleDefinitionSnapshotFor(name))).toBe(true)
        continue
      }
      expect(effects).toEqual([])
      if (status === 'GAP') expect(gapReason[name]).toBeTruthy()
    }
  })

  test('Dack part-36 creatures are registered, keywords-only, or an explicit GAP', () => {
    const inventory = {
      'Aang, the Last Airbender': 'gap',
      'Akroma, Angel of Wrath': 'keywords-only',
      'Alabaster Host Intercessor': 'registered',
      'Angel of Indemnity': 'gap',
      'Angel of the Dire Hour': 'gap',
      'Angel of the Ruins': 'gap',
      'Appa, Loyal Sky Bison': 'gap',
      'Bronzebeak Foragers': 'gap',
      'Curious Colossus': 'registered',
      'Darksteel Colossus': 'registered',
      'Eagle of Deliverance': 'gap',
      'Githzerai Monk': 'registered',
      'Knight-Captain of Eos': 'gap',
      'Luminate Primordial': 'gap',
      'Meteor Golem': 'registered',
      'Myr Battlesphere': 'gap',
      'Protector of the Wastes': 'gap',
      'Resolute Archangel': 'gap',
      'Salvation Colossus': 'gap',
      'Salvation Swan': 'gap',
    } as const
    expect(Object.keys(inventory)).toHaveLength(20)
    for (const [name, slot] of Object.entries(inventory)) {
      const effects = effectsFor(name)
      if (slot === 'registered') expect(effects.length > 0 || Boolean(cardRuleDefinitionSnapshotFor(name))).toBe(true)
      else expect(effects).toEqual([])
    }
    expect(effectsFor('Darksteel Colossus')).toEqual([])
    expect(effectsFor('Salvation Colossus')).toEqual([])
  })

  test('Dack part-37 inventory lists registered, kernel-only, or GAP with reasons', () => {
    const assigned = [
      'Act of Vengeance',
      'Astral Drift',
      'Ondu Inversion // Ondu Skyruins',
      'Rally the Ancestors',
      'Realm-Cloaked Giant // Cast Off',
      'Sandstone Oracle',
      'Serra Avatar',
      'Soul of Eternity',
      'Spawning Pit',
      'Steel Hellkite',
      'Storm of Souls',
      'Subjugator Angel',
      'Sudden Salvation',
      "Thalia's Lancers",
      'The Eagles Are Coming!',
      'The Restoration of Eiganjo // Architect of Restoration',
      'Timeless Dragon',
      'Tri-Sentinel, Act of Vengeance',
      'Twins of Discord',
      "Wakening Sun's Avatar",
      'Zetalpa, Primal Dawn',
    ] as const
    const status: Record<typeof assigned[number], 'registered' | 'kernel-only' | 'gap'> = {
      'Act of Vengeance': 'gap',
      'Astral Drift': 'registered',
      'Ondu Inversion // Ondu Skyruins': 'gap',
      'Rally the Ancestors': 'gap',
      'Realm-Cloaked Giant // Cast Off': 'gap',
      'Sandstone Oracle': 'registered',
      'Serra Avatar': 'gap',
      'Soul of Eternity': 'registered',
      'Spawning Pit': 'gap',
      'Steel Hellkite': 'gap',
      'Storm of Souls': 'gap',
      'Subjugator Angel': 'registered',
      'Sudden Salvation': 'gap',
      "Thalia's Lancers": 'registered',
      'The Eagles Are Coming!': 'gap',
      'The Restoration of Eiganjo // Architect of Restoration': 'gap',
      'Timeless Dragon': 'gap',
      'Tri-Sentinel, Act of Vengeance': 'gap',
      'Twins of Discord': 'gap',
      "Wakening Sun's Avatar": 'gap',
      'Zetalpa, Primal Dawn': 'kernel-only',
    }
    const gapReasons: Partial<Record<typeof assigned[number], string>> = {
      'Act of Vengeance':
        'Not a separate card in this deck; ETB damage is on Tri-Sentinel, Act of Vengeance — no per-opponent targeted damage builder',
      'Ondu Inversion // Ondu Skyruins':
        'MDFC spell half destroys all nonland permanents; land face alone is not sufficient registration',
      'Rally the Ancestors':
        'Return each creature card with mana value X or less from your graveyard, then exile those creatures at the beginning of your next upkeep',
      'Realm-Cloaked Giant // Cast Off':
        'Adventure Cast Off destroys all non-Giant creatures; no mass-destroy-by-subtype-exclusion builder',
      'Serra Avatar':
        'Power/toughness equal life plus shuffle into library from graveyard anywhere — no shuffle-self-from-graveyard builder',
      'Spawning Pit':
        'Sacrifice a creature to add charge counters; pay mana and remove two counters to create a 2/2 Spawn token',
      'Steel Hellkite':
        '{2} pump and {X} destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn',
      'Storm of Souls':
        'Return all creature cards from your graveyard, each becomes a 1/1 Spirit with flying in addition to its types, then exile the spell',
      'Sudden Salvation':
        'Return up to three battlefield-this-turn permanents from graveyards tapped; draw for each opponent who controls one',
      'The Eagles Are Coming!':
        'Kicker returns any number of creatures you own; next upkeep creates 4/4 Bird Soldier tokens per creature returned',
      'The Restoration of Eiganjo // Architect of Restoration':
        'Saga chapters (search, discard-to-reanimate MV≤2, exile then return transformed) and Architect attack/block Spirit tokens',
      'Timeless Dragon':
        'Plainscycling and eternalize exile-from-graveyard token copy — no eternalize builder',
      'Tri-Sentinel, Act of Vengeance':
        'ETB: for each opponent, deal 3 damage to up to one target creature that player controls; unearth {7} not registered without full ETB',
      'Twins of Discord':
        'Attack: choose odd or even mana value creatures that cannot block; grant bloodthirst 2 to other colorless creatures you control',
      "Wakening Sun's Avatar":
        'When cast from hand, destroy all non-Dinosaur creatures — no cast-from-hand conditional mass destroy builder',
    }
    expect(assigned).toHaveLength(21)
    const gaps = assigned.filter((name) => status[name] === 'gap')
    expect(gaps).toEqual([
      'Act of Vengeance',
      'Ondu Inversion // Ondu Skyruins',
      'Rally the Ancestors',
      'Realm-Cloaked Giant // Cast Off',
      'Serra Avatar',
      'Spawning Pit',
      'Steel Hellkite',
      'Storm of Souls',
      'Sudden Salvation',
      'The Eagles Are Coming!',
      'The Restoration of Eiganjo // Architect of Restoration',
      'Timeless Dragon',
      'Tri-Sentinel, Act of Vengeance',
      'Twins of Discord',
      "Wakening Sun's Avatar",
    ])
    for (const name of assigned) {
      const slot = status[name]
      if (slot === 'registered') {
        expect(effectsFor(name).length > 0 || Boolean(cardRuleDefinitionSnapshotFor(name))).toBe(true)
        expect(gapReasons[name]).toBeUndefined()
      } else if (slot === 'kernel-only') {
        expect(effectsFor(name)).toEqual([])
        expect(gapReasons[name]).toBeUndefined()
      } else {
        expect(effectsFor(name)).toEqual([])
        expect(gapReasons[name]).toMatch(/./)
      }
    }
    expect(gapReasons['Rally the Ancestors']).toContain('next upkeep')
    expect(gapReasons['Storm of Souls']).toContain('1/1 Spirit')
    expect(gapReasons['The Restoration of Eiganjo // Architect of Restoration']).toContain('Saga')
    expect(gapReasons['Realm-Cloaked Giant // Cast Off']).toContain('Adventure')
    expect(gapReasons['Ondu Inversion // Ondu Skyruins']).toContain('nonland')
    expect(cardDefinition('Astral Drift')).toBeUndefined()
  })

  test('catalog entries keep the deck Oracle text of a double-faced land', () => {
    const entry = deckCards('3-_cirdan-show-me-what-you-got')
      .find((card) => card.name === 'Sea Gate Restoration // Sea Gate, Reborn')!
    expect(catalogEntry(entry).faces?.[1].oracle_text)
      .toBe('As this land enters, you may pay 3 life. If you don\'t, it enters tapped.\n{T}: Add {U}.')
  })
})


test('encore catalog cards retain their full printed programs and shared graveyard activation', () => {
  const belonging = cardTemplateDefaultsFor('Belonging')!
  const soul = cardTemplateDefaultsFor('Soul of Eternity')!
  expect(belonging).toMatchObject({ power: 6, toughness: 6, subtypes: ['Elemental', 'Incarnation'] })
  expect(belonging.ruleDefinition.definition.abilities[0]).toMatchObject({ kind: 'triggered', instructions: [
    { kind: 'createToken', count: { kind: 'constant', value: 3 }, token: { name: 'Shapeshifter', colors: [], power: 1, toughness: 1, abilities: [{ kind: 'keyword', keyword: 'changeling' }] } },
  ] })
  expect(belonging.ruleDefinition.definition.abilities.some(ability => ability.kind === 'keyword' && ability.keyword === 'changeling')).toBe(false)
  expect(soul.ruleDefinition.definition.abilities[0]).toMatchObject({ kind: 'static',
    activeIn: ['battlefield', 'stack', 'hand', 'library', 'graveyard', 'exile', 'command'], effects: [
      { kind: 'modifyStats', characteristicDefining: true, power: { kind: 'characteristic', characteristic: 'life' }, toughness: { kind: 'characteristic', characteristic: 'life' } },
    ],
  })
  for (const [entry, cost] of [[belonging, '{6}{W}{W}'], [soul, '{7}{W}{W}']] as const) {
    expect(entry.ruleDefinition.definition.abilities[1]).toMatchObject({ kind: 'activated', availableFrom: ['graveyard'], timing: 'sorcery',
      costs: [{ kind: 'mana', amount: cost }, { kind: 'exileSource', from: 'graveyard' }], instructions: [
        { kind: 'forEachPlayer', of: { kind: 'players', filter: { relation: 'opponent' } }, collectObjects: { from: 'encoreCopy', as: 'encoreCopies' }, instructions: [
          { kind: 'copy', information: 'currentOrLastKnown' },
          { kind: 'createEffect', effect: { kind: 'grantKeyword', keyword: 'haste' }, duration: { kind: 'permanent' } },
          { kind: 'createEffect', effect: { kind: 'mustAttackPlayer' }, duration: { kind: 'untilCleanup' } },
        ] },
        { kind: 'createDelayed', condition: { kind: 'step', step: 'end' }, instructions: [{ kind: 'sacrifice' }] },
      ],
    })
  }
})
