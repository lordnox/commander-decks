/** Player-level effects a resolving program can create (CR 702.11d, 702.16k, 119.7, 119.8, 104.3). */
export const PLAYER_EFFECTS = {
  hexproof: 'hexproof',
  protectionFromEverything: 'protectionFromEverything',
  lifeTotalCannotChange: 'lifeTotalCannotChange',
  cannotLoseLife: 'cannotLoseLife',
  cannotLoseGame: 'cannotLoseGame',
  cannotWinGame: 'cannotWinGame',
} as const
export type PlayerEffect = typeof PLAYER_EFFECTS[keyof typeof PLAYER_EFFECTS]

/** "This turn" ends at cleanup; "until your next turn" ends as the creating controller's next turn begins. */
export const PLAYER_EFFECT_DURATIONS = {
  untilCleanup: 'untilCleanup',
  untilYourNextTurn: 'untilYourNextTurn',
} as const
export type PlayerEffectDuration = typeof PLAYER_EFFECT_DURATIONS[keyof typeof PLAYER_EFFECT_DURATIONS]

/** Rule plugin that owns the restrictions without a dedicated legacy plugin. */
export const PLAYER_EFFECTS_PLUGIN_ID = 'playerEffects'

/** Rule plugin that enforces each player effect; protection and life locks keep their existing owners. */
export const PLAYER_EFFECT_RULE_PLUGINS = {
  [PLAYER_EFFECTS.hexproof]: PLAYER_EFFECTS_PLUGIN_ID,
  [PLAYER_EFFECTS.protectionFromEverything]: 'protectionFromEverything',
  [PLAYER_EFFECTS.lifeTotalCannotChange]: 'lifeTotalLock',
  [PLAYER_EFFECTS.cannotLoseLife]: PLAYER_EFFECTS_PLUGIN_ID,
  [PLAYER_EFFECTS.cannotLoseGame]: PLAYER_EFFECTS_PLUGIN_ID,
  [PLAYER_EFFECTS.cannotWinGame]: PLAYER_EFFECTS_PLUGIN_ID,
} as const satisfies Record<PlayerEffect, string>
