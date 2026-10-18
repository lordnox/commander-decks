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
import botanicalSanctum from './botanical-sanctum'
import buriedAlive from './buried-alive'
import castleGarenbrig from './castle-garenbrig'
import charcoalDiamond from './charcoal-diamond'
import commandersSphere from './commanders-sphere'
import concealedCourtyard from './concealed-courtyard'
import counterspell from './counterspell'
import cropRotation from './crop-rotation'
import crypticCommand from './cryptic-command'
import desertedTemple from './deserted-temple'
import diabolicTutor from './diabolic-tutor'
import dismember from './dismember'
import drownedCatacomb from './drowned-catacomb'
import duskdaleWurm from './duskdale-wurm'
import eclipsedSteppe from './eclipsed-steppe'
import entomb from './entomb'
import esperCharm from './esper-charm'
import eternalWitness from './eternal-witness'
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
import growthSpiral from './growth-spiral'
import harrow from './harrow'
import hinterlandHarbor from './hinterland-harbor'
import malakirMire from './malakir-mire'
import minamoSchoolAtWatersEdge from './minamo-school-at-waters-edge'
import mindStone from './mind-stone'
import mistvaultBridge from './mistvault-bridge'
import morphicPool from './morphic-pool'
import murder from './murder'
import naturesLore from './natures-lore'
import nightsWhisper from './nights-whisper'
import oboroPalaceInTheClouds from './oboro-palace-in-the-clouds'
import rejuvenatingSprings from './rejuvenating-springs'
import restInPeace from './rest-in-peace'
import reverberate from './reverberate'
import sakuraTribeElder from './sakura-tribe-elder'
import seleniaDarkAngel from './selenia-dark-angel'
import signInBlood from './sign-in-blood'
import skyDiamond from './sky-diamond'
import splendidReclamation from './splendid-reclamation'
import stitchersSupplier from './stitchers-supplier'
import subjugatorAngel from './subjugator-angel'
import sunkenHollow from './sunken-hollow'
import thragtusk from './thragtusk'
import threeVisits from './three-visits'
import twincast from './twincast'
import unmarkedGrave from './unmarked-grave'
import vampireHounds from './vampire-hounds'
import vaultOfChampions from './vault-of-champions'
import wallOfBlood from './wall-of-blood'
import wallOfOmens from './wall-of-omens'
import waterloggedGrove from './waterlogged-grove'
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
  "Botanical Sanctum": botanicalSanctum,
  "Buried Alive": buriedAlive,
  "Castle Garenbrig": castleGarenbrig,
  "Charcoal Diamond": charcoalDiamond,
  "Commander's Sphere": commandersSphere,
  "Concealed Courtyard": concealedCourtyard,
  "Counterspell": counterspell,
  "Crop Rotation": cropRotation,
  "Cryptic Command": crypticCommand,
  "Deserted Temple": desertedTemple,
  "Diabolic Tutor": diabolicTutor,
  "Dismember": dismember,
  "Drowned Catacomb": drownedCatacomb,
  "Duskdale Wurm": duskdaleWurm,
  "Eclipsed Steppe": eclipsedSteppe,
  "Entomb": entomb,
  "Esper Charm": esperCharm,
  "Eternal Witness": eternalWitness,
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
  "Growth Spiral": growthSpiral,
  "Harrow": harrow,
  "Hinterland Harbor": hinterlandHarbor,
  "Malakir Mire": malakirMire,
  "Minamo, School at Water's Edge": minamoSchoolAtWatersEdge,
  "Mind Stone": mindStone,
  "Mistvault Bridge": mistvaultBridge,
  "Morphic Pool": morphicPool,
  "Murder": murder,
  "Nature's Lore": naturesLore,
  "Night's Whisper": nightsWhisper,
  "Oboro, Palace in the Clouds": oboroPalaceInTheClouds,
  "Rejuvenating Springs": rejuvenatingSprings,
  "Rest in Peace": restInPeace,
  "Reverberate": reverberate,
  "Sakura-Tribe Elder": sakuraTribeElder,
  "Selenia, Dark Angel": seleniaDarkAngel,
  "Sign in Blood": signInBlood,
  "Sky Diamond": skyDiamond,
  "Splendid Reclamation": splendidReclamation,
  "Stitcher's Supplier": stitchersSupplier,
  "Subjugator Angel": subjugatorAngel,
  "Sunken Hollow": sunkenHollow,
  "Thragtusk": thragtusk,
  "Three Visits": threeVisits,
  "Twincast": twincast,
  "Unmarked Grave": unmarkedGrave,
  "Vampire Hounds": vampireHounds,
  "Vault of Champions": vaultOfChampions,
  "Wall of Blood": wallOfBlood,
  "Wall of Omens": wallOfOmens,
  "Waterlogged Grove": waterloggedGrove,
  "Worn Powerstone": wornPowerstone,
})
