import type { CatalogEntry } from './types'
import absorb from './absorb'
import abundance from './abundance'
import aesiTyrantOfGyreStrait from './aesi-tyrant-of-gyre-strait'
import aetherize from './aetherize'
import aftermathAnalyst from './aftermath-analyst'
import anguishedUnmaking from './anguished-unmaking'
import balaGedSanctuary from './bala-ged-sanctuary'
import buriedAlive from './buried-alive'
import charcoalDiamond from './charcoal-diamond'
import counterspell from './counterspell'
import diabolicTutor from './diabolic-tutor'
import dismember from './dismember'
import duskdaleWurm from './duskdale-wurm'
import entomb from './entomb'
import esperCharm from './esper-charm'
import eternalWitness from './eternal-witness'
import fateUnraveler from './fate-unraveler'
import fellMire from './fell-mire'
import flameRift from './flame-rift'
import foil from './foil'
import gloriousAnthem from './glorious-anthem'
import growthSpiral from './growth-spiral'
import harrow from './harrow'
import malakirMire from './malakir-mire'
import mistvaultBridge from './mistvault-bridge'
import murder from './murder'
import naturesLore from './natures-lore'
import nightsWhisper from './nights-whisper'
import restInPeace from './rest-in-peace'
import reverberate from './reverberate'
import signInBlood from './sign-in-blood'
import skyDiamond from './sky-diamond'
import splendidReclamation from './splendid-reclamation'
import stitchersSupplier from './stitchers-supplier'
import thragtusk from './thragtusk'
import threeVisits from './three-visits'
import twincast from './twincast'
import unmarkedGrave from './unmarked-grave'
import vampireHounds from './vampire-hounds'
import wallOfOmens from './wall-of-omens'
import wornPowerstone from './worn-powerstone'

/** Explicit imports keep browser and host builds independent of filesystem discovery. */
export const CARD_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze({
  "Absorb": absorb,
  "Abundance": abundance,
  "Aesi, Tyrant of Gyre Strait": aesiTyrantOfGyreStrait,
  "Aetherize": aetherize,
  "Aftermath Analyst": aftermathAnalyst,
  "Anguished Unmaking": anguishedUnmaking,
  "Bala Ged Sanctuary": balaGedSanctuary,
  "Buried Alive": buriedAlive,
  "Charcoal Diamond": charcoalDiamond,
  "Counterspell": counterspell,
  "Diabolic Tutor": diabolicTutor,
  "Dismember": dismember,
  "Duskdale Wurm": duskdaleWurm,
  "Entomb": entomb,
  "Esper Charm": esperCharm,
  "Eternal Witness": eternalWitness,
  "Fate Unraveler": fateUnraveler,
  "Fell Mire": fellMire,
  "Flame Rift": flameRift,
  "Foil": foil,
  "Glorious Anthem": gloriousAnthem,
  "Growth Spiral": growthSpiral,
  "Harrow": harrow,
  "Malakir Mire": malakirMire,
  "Mistvault Bridge": mistvaultBridge,
  "Murder": murder,
  "Nature's Lore": naturesLore,
  "Night's Whisper": nightsWhisper,
  "Rest in Peace": restInPeace,
  "Reverberate": reverberate,
  "Sign in Blood": signInBlood,
  "Sky Diamond": skyDiamond,
  "Splendid Reclamation": splendidReclamation,
  "Stitcher's Supplier": stitchersSupplier,
  "Thragtusk": thragtusk,
  "Three Visits": threeVisits,
  "Twincast": twincast,
  "Unmarked Grave": unmarkedGrave,
  "Vampire Hounds": vampireHounds,
  "Wall of Omens": wallOfOmens,
  "Worn Powerstone": wornPowerstone,
})
