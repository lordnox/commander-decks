import type { CatalogEntry } from './types'
import absorb from './absorb'
import abundance from './abundance'
import aesiTyrantOfGyreStrait from './aesi-tyrant-of-gyre-strait'
import aetherize from './aetherize'
import aftermathAnalyst from './aftermath-analyst'
import anguishedUnmaking from './anguished-unmaking'
import buriedAlive from './buried-alive'
import counterspell from './counterspell'
import diabolicTutor from './diabolic-tutor'
import dismember from './dismember'
import duskdaleWurm from './duskdale-wurm'
import entomb from './entomb'
import esperCharm from './esper-charm'
import eternalWitness from './eternal-witness'
import fateUnraveler from './fate-unraveler'
import flameRift from './flame-rift'
import foil from './foil'
import gloriousAnthem from './glorious-anthem'
import growthSpiral from './growth-spiral'
import harrow from './harrow'
import murder from './murder'
import naturesLore from './natures-lore'
import nightsWhisper from './nights-whisper'
import restInPeace from './rest-in-peace'
import reverberate from './reverberate'
import signInBlood from './sign-in-blood'
import thragtusk from './thragtusk'
import threeVisits from './three-visits'
import vampireHounds from './vampire-hounds'
import wallOfOmens from './wall-of-omens'

/** Explicit imports keep browser and host builds independent of filesystem discovery. */
export const CARD_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze({
  "Absorb": absorb,
  "Abundance": abundance,
  "Aesi, Tyrant of Gyre Strait": aesiTyrantOfGyreStrait,
  "Aetherize": aetherize,
  "Aftermath Analyst": aftermathAnalyst,
  "Anguished Unmaking": anguishedUnmaking,
  "Buried Alive": buriedAlive,
  "Counterspell": counterspell,
  "Diabolic Tutor": diabolicTutor,
  "Dismember": dismember,
  "Duskdale Wurm": duskdaleWurm,
  "Entomb": entomb,
  "Esper Charm": esperCharm,
  "Eternal Witness": eternalWitness,
  "Fate Unraveler": fateUnraveler,
  "Flame Rift": flameRift,
  "Foil": foil,
  "Glorious Anthem": gloriousAnthem,
  "Growth Spiral": growthSpiral,
  "Harrow": harrow,
  "Murder": murder,
  "Nature's Lore": naturesLore,
  "Night's Whisper": nightsWhisper,
  "Rest in Peace": restInPeace,
  "Reverberate": reverberate,
  "Sign in Blood": signInBlood,
  "Thragtusk": thragtusk,
  "Three Visits": threeVisits,
  "Vampire Hounds": vampireHounds,
  "Wall of Omens": wallOfOmens,
})
