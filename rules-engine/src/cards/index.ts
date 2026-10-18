import type { CatalogEntry } from './types'
import absorb from './absorb'
import abundance from './abundance'
import aesiTyrantOfGyreStrait from './aesi-tyrant-of-gyre-strait'
import aetherize from './aetherize'
import aftermathAnalyst from './aftermath-analyst'
import anguishedUnmaking from './anguished-unmaking'
import arborElf from './arbor-elf'
import arcanisTheOmnipotent from './arcanis-the-omnipotent'
import balaGedRecovery from './bala-ged-recovery'
import balaGedSanctuary from './bala-ged-sanctuary'
import blightedWoodland from './blighted-woodland'
import botanicalSanctum from './botanical-sanctum'
import brokersHideout from './brokers-hideout'
import buriedAlive from './buried-alive'
import cabalCoffers from './cabal-coffers'
import cabalStronghold from './cabal-stronghold'
import castleGarenbrig from './castle-garenbrig'
import charcoalDiamond from './charcoal-diamond'
import commandersSphere from './commanders-sphere'
import concealedCourtyard from './concealed-courtyard'
import counterspell from './counterspell'
import cropRotation from './crop-rotation'
import crypticCommand from './cryptic-command'
import desertedTemple from './deserted-temple'
import diabolicTutor from './diabolic-tutor'
import dimirAqueduct from './dimir-aqueduct'
import dimirSignet from './dimir-signet'
import dismember from './dismember'
import drownedCatacomb from './drowned-catacomb'
import duskdaleWurm from './duskdale-wurm'
import eclipsedSteppe from './eclipsed-steppe'
import entomb from './entomb'
import esperCharm from './esper-charm'
import esperPanorama from './esper-panorama'
import eternalWitness from './eternal-witness'
import evolvingWilds from './evolving-wilds'
import expeditionMap from './expedition-map'
import farhavenElf from './farhaven-elf'
import farseek from './farseek'
import fateUnraveler from './fate-unraveler'
import fellMire from './fell-mire'
import flameRift from './flame-rift'
import foil from './foil'
import franticSearch from './frantic-search'
import geierReachSanitarium from './geier-reach-sanitarium'
import githzeraiMonk from './githzerai-monk'
import glacialFortress from './glacial-fortress'
import gloriousAnthem from './glorious-anthem'
import golgariRotFarm from './golgari-rot-farm'
import growthSpiral from './growth-spiral'
import harrow from './harrow'
import hedgeMaze from './hedge-maze'
import hedronArchive from './hedron-archive'
import hinterlandHarbor from './hinterland-harbor'
import magusOfTheCoffers from './magus-of-the-coffers'
import malakirMire from './malakir-mire'
import marshFlats from './marsh-flats'
import minamoSchoolAtWatersEdge from './minamo-school-at-waters-edge'
import mindStone from './mind-stone'
import mistvaultBridge from './mistvault-bridge'
import mistyRainforest from './misty-rainforest'
import morphicPool from './morphic-pool'
import murder from './murder'
import naturesLore from './natures-lore'
import nightsWhisper from './nights-whisper'
import oboroPalaceInTheClouds from './oboro-palace-in-the-clouds'
import obscuraStorefront from './obscura-storefront'
import orzhovBasilica from './orzhov-basilica'
import orzhovSignet from './orzhov-signet'
import pollutedDelta from './polluted-delta'
import prismaticVista from './prismatic-vista'
import rejuvenatingSprings from './rejuvenating-springs'
import restInPeace from './rest-in-peace'
import reverberate from './reverberate'
import riveteersOverlook from './riveteers-overlook'
import sakuraTribeElder from './sakura-tribe-elder'
import seleniaDarkAngel from './selenia-dark-angel'
import shadowyBackstreet from './shadowy-backstreet'
import signInBlood from './sign-in-blood'
import simicGrowthChamber from './simic-growth-chamber'
import simicSignet from './simic-signet'
import skyDiamond from './sky-diamond'
import splendidReclamation from './splendid-reclamation'
import stitchTogether from './stitch-together'
import stitchersSupplier from './stitchers-supplier'
import subjugatorAngel from './subjugator-angel'
import sunkenHollow from './sunken-hollow'
import templeOfDeceit from './temple-of-deceit'
import terramorphicExpanse from './terramorphic-expanse'
import thaliasLancers from './thalias-lancers'
import thragtusk from './thragtusk'
import threeVisits from './three-visits'
import twincast from './twincast'
import undercitySewers from './undercity-sewers'
import undergroundMortuary from './underground-mortuary'
import unmarkedGrave from './unmarked-grave'
import vampireHounds from './vampire-hounds'
import vaultOfChampions from './vault-of-champions'
import verdantCatacombs from './verdant-catacombs'
import wallOfBlood from './wall-of-blood'
import wallOfOmens from './wall-of-omens'
import waterloggedGrove from './waterlogged-grove'
import worldMap from './world-map'
import wornPowerstone from './worn-powerstone'

/** Explicit imports keep browser and host builds independent of filesystem discovery. */
export const CARD_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze({
  "Absorb": absorb,
  "Abundance": abundance,
  "Aesi, Tyrant of Gyre Strait": aesiTyrantOfGyreStrait,
  "Aetherize": aetherize,
  "Aftermath Analyst": aftermathAnalyst,
  "Anguished Unmaking": anguishedUnmaking,
  "Arbor Elf": arborElf,
  "Arcanis the Omnipotent": arcanisTheOmnipotent,
  "Bala Ged Recovery // Bala Ged Sanctuary": balaGedRecovery,
  "Bala Ged Recovery": balaGedRecovery,
  "Bala Ged Sanctuary": balaGedSanctuary,
  "Blighted Woodland": blightedWoodland,
  "Botanical Sanctum": botanicalSanctum,
  "Brokers Hideout": brokersHideout,
  "Buried Alive": buriedAlive,
  "Cabal Coffers": cabalCoffers,
  "Cabal Stronghold": cabalStronghold,
  "Castle Garenbrig": castleGarenbrig,
  "Charcoal Diamond": charcoalDiamond,
  "Commander's Sphere": commandersSphere,
  "Concealed Courtyard": concealedCourtyard,
  "Counterspell": counterspell,
  "Crop Rotation": cropRotation,
  "Cryptic Command": crypticCommand,
  "Deserted Temple": desertedTemple,
  "Diabolic Tutor": diabolicTutor,
  "Dimir Aqueduct": dimirAqueduct,
  "Dimir Signet": dimirSignet,
  "Dismember": dismember,
  "Drowned Catacomb": drownedCatacomb,
  "Duskdale Wurm": duskdaleWurm,
  "Eclipsed Steppe": eclipsedSteppe,
  "Entomb": entomb,
  "Esper Charm": esperCharm,
  "Esper Panorama": esperPanorama,
  "Eternal Witness": eternalWitness,
  "Evolving Wilds": evolvingWilds,
  "Expedition Map": expeditionMap,
  "Farhaven Elf": farhavenElf,
  "Farseek": farseek,
  "Fate Unraveler": fateUnraveler,
  "Fell Mire": fellMire,
  "Flame Rift": flameRift,
  "Foil": foil,
  "Frantic Search": franticSearch,
  "Geier Reach Sanitarium": geierReachSanitarium,
  "Githzerai Monk": githzeraiMonk,
  "Glacial Fortress": glacialFortress,
  "Glorious Anthem": gloriousAnthem,
  "Golgari Rot Farm": golgariRotFarm,
  "Growth Spiral": growthSpiral,
  "Harrow": harrow,
  "Hedge Maze": hedgeMaze,
  "Hedron Archive": hedronArchive,
  "Hinterland Harbor": hinterlandHarbor,
  "Magus of the Coffers": magusOfTheCoffers,
  "Malakir Mire": malakirMire,
  "Marsh Flats": marshFlats,
  "Minamo, School at Water's Edge": minamoSchoolAtWatersEdge,
  "Mind Stone": mindStone,
  "Mistvault Bridge": mistvaultBridge,
  "Misty Rainforest": mistyRainforest,
  "Morphic Pool": morphicPool,
  "Murder": murder,
  "Nature's Lore": naturesLore,
  "Night's Whisper": nightsWhisper,
  "Oboro, Palace in the Clouds": oboroPalaceInTheClouds,
  "Obscura Storefront": obscuraStorefront,
  "Orzhov Basilica": orzhovBasilica,
  "Orzhov Signet": orzhovSignet,
  "Polluted Delta": pollutedDelta,
  "Prismatic Vista": prismaticVista,
  "Rejuvenating Springs": rejuvenatingSprings,
  "Rest in Peace": restInPeace,
  "Reverberate": reverberate,
  "Riveteers Overlook": riveteersOverlook,
  "Sakura-Tribe Elder": sakuraTribeElder,
  "Selenia, Dark Angel": seleniaDarkAngel,
  "Shadowy Backstreet": shadowyBackstreet,
  "Sign in Blood": signInBlood,
  "Simic Growth Chamber": simicGrowthChamber,
  "Simic Signet": simicSignet,
  "Sky Diamond": skyDiamond,
  "Splendid Reclamation": splendidReclamation,
  "Stitch Together": stitchTogether,
  "Stitcher's Supplier": stitchersSupplier,
  "Subjugator Angel": subjugatorAngel,
  "Sunken Hollow": sunkenHollow,
  "Temple of Deceit": templeOfDeceit,
  "Terramorphic Expanse": terramorphicExpanse,
  "Thalia's Lancers": thaliasLancers,
  "Thragtusk": thragtusk,
  "Three Visits": threeVisits,
  "Twincast": twincast,
  "Undercity Sewers": undercitySewers,
  "Underground Mortuary": undergroundMortuary,
  "Unmarked Grave": unmarkedGrave,
  "Vampire Hounds": vampireHounds,
  "Vault of Champions": vaultOfChampions,
  "Verdant Catacombs": verdantCatacombs,
  "Wall of Blood": wallOfBlood,
  "Wall of Omens": wallOfOmens,
  "Waterlogged Grove": waterloggedGrove,
  "World Map": worldMap,
  "Worn Powerstone": wornPowerstone,
})
