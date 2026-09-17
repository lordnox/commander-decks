import { emptyMana } from './draft'
import { PERMANENT_TYPES } from './definitions'
import { manaModes, poolForChoice } from './plugins/mana'
import { payCost } from './plugins/spells'
import { effectsOf } from './cardPlugins/cardRules'
import { activateEffect, conditionHolds, type ActivateCost } from './cardPlugins/effects'
import { validTarget } from './cardPlugins/targetedResolve'
import { hasKeyword } from './keywords'
import type {
  GameEvent,
  GameObject,
  GameState,
  ManaId,
  ManaPool,
  PlayerId,
} from './types'

export type AvailableAction =
  | { kind: 'playLand'; objectId: string; name: string }
  | {
      kind: 'castSpell'
      objectId: string
      name: string
      targetObjectId?: string
      targetName?: string
    }
  | {
      kind: 'activateAbility'
      objectId: string
      name: string
      text: string
      abilityId?: string
      targetObjectIds?: string[]
      targetGroups?: Array<{
        label: string
        min: number
        max: number
        targets: Array<{ objectId: string; name: string; controller: PlayerId }>
      }>
    }
  | { kind: 'tapForMana'; objectId: string; name: string; mana?: ManaId }
  | { kind: 'declareAttackers'; objectIds: string[] }
  | { kind: 'declareBlockers'; objectIds: string[]; attackerIds: string[] }

const MAIN_STEPS = new Set(['precombatMain', 'postcombatMain'])
const DAMAGE_PENDING_STEPS = new Set([
  'declareAttackers',
  'declareBlockers',
  'firstStrikeDamage',
  'combatDamage',
])
const MANA_IDS: ManaId[] = ['W', 'U', 'B', 'R', 'G', 'C']

const addPool = (left: ManaPool, right: Partial<ManaPool>) => {
  const sum = { ...left }
  for (const mana of MANA_IDS) sum[mana] += right[mana] ?? 0
  return sum
}

const samePool = (left: Partial<ManaPool>, right?: Partial<ManaPool>) =>
  !!right && MANA_IDS.every((mana) => (left[mana] ?? 0) === (right[mana] ?? 0))

/**
 * The tapForMana choice that yields exactly `mode` from `source`, or null when
 * the reducer cannot be steered to that mode.
 */
const tapChoice = (
  state: GameState,
  source: GameObject,
  mode: Partial<ManaPool>,
): { mana?: ManaId } | null => {
  if (samePool(mode, poolForChoice(source, undefined, state))) return {}
  const mana = MANA_IDS.find((symbol) => (mode[symbol] ?? 0) > 0)
  if (mana && samePool(mode, poolForChoice(source, mana, state))) return { mana }
  return null
}

const sourceCanTap = (object: GameObject, seat: PlayerId, state: GameState) =>
  object.zone === 'battlefield'
  && object.controller === seat
  && !object.tapped
  && (
    !object.types.includes('Creature')
    || !object.summoningSickness
    || hasKeyword(object, 'haste', state)
  )

const poolKey = (pool: ManaPool, cap: number) =>
  MANA_IDS.map((mana) => Math.min(pool[mana], cap)).join(',')

const canFund = (state: GameState, seat: PlayerId, cost: string) => {
  const sources = Object.values(state.objects)
    .filter((object) => sourceCanTap(object, seat, state))
    .map((object) => manaModes(object, state))
    .filter((modes) => modes.length > 0)
  const cap = Math.max(
    1,
    [...cost.matchAll(/\{(\d+)\}/g)].reduce(
      (total, match) => total + Number(match[1]),
      [...cost.matchAll(/\{[WUBRGC](?:\/[WUBRGC])?\}/g)].length,
    ),
  )
  let pools = [state.players[seat]?.mana ?? emptyMana()]
  for (const modes of sources) {
    const next = new Map<string, ManaPool>()
    for (const pool of pools) {
      for (const mode of modes) {
        const candidate = addPool(pool, mode)
        next.set(poolKey(candidate, cap), candidate)
      }
    }
    pools = [...next.values()]
  }
  return pools.some((pool) => payCost(pool, cost))
}

const taxFor = (state: GameState, seat: PlayerId, object: GameObject) => {
  if (object.zone !== 'command' || !object.tags.includes('commander')) return 0
  const taxes = state.players[seat]?.data.commanderTax
  if (!taxes || typeof taxes !== 'object' || Array.isArray(taxes)) return 0
  const value = (taxes as Record<string, unknown>)[object.id]
  return typeof value === 'number' ? value : 0
}

/**
 * A spell that can only target something on the stack is not merely uncertain
 * with an empty stack, it is uncastable. Offering it would stop the human at
 * every otherwise empty priority window.
 */
const needsStackTarget = (object: GameObject) =>
  /counter target[^.]*\b(spell|ability)\b/i.test(object.oracleText)

const canCastNow = (state: GameState, seat: PlayerId, object: GameObject) => {
  if (!state.castableZones.includes(object.zone)) return false
  if (object.types.includes('Land')) return false
  if (object.owner !== seat || object.controller !== seat) return false
  if (state.stack.length === 0 && needsStackTarget(object)) return false
  if (
    !object.types.includes('Instant')
    && (
      state.active !== seat
      || !MAIN_STEPS.has(state.step)
      || state.stack.length > 0
    )
  ) {
    return false
  }
  const tax = taxFor(state, seat, object)
  return canFund(state, seat, `${object.manaCost}${tax > 0 ? `{${tax}}` : ''}`)
}

const activatedText = (object: GameObject) =>
  object.oracleText
    .split('\n')
    .filter((line) => {
      const colon = line.indexOf(':')
      if (colon < 0) return false
      const effect = line.slice(colon + 1)
      return !/^\s*Add\b/i.test(effect)
    })

const canActivate = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
  line: string,
) => {
  if (object.zone !== 'battlefield' || object.controller !== seat) return false
  const cost = line.slice(0, line.indexOf(':'))
  if (/\{T\}/i.test(cost) && !sourceCanTap(object, seat, state)) return false
  if (
    (/activate only as a sorcery/i.test(line) || /^[+−-]\d+:/u.test(line))
    && (
      state.active !== seat
      || !MAIN_STEPS.has(state.step)
      || state.stack.length > 0
    )
  ) {
    return false
  }
  if (/^[+−-]\d+:/u.test(line)) {
    if (object.loyaltyActivatedTurn === state.turn) return false
    const amount = Number(line.match(/^[+−-](\d+)/u)?.[1] ?? 0)
    if (/^[−-]/u.test(line) && (object.counters.loyalty ?? 0) < amount) return false
  }
  // A free fog is legal in every window, so enumerating it everywhere would
  // stop its controller at every step of every turn. Surface it once combat
  // damage is actually threatened; a later combat redeclares attackers and
  // reopens the window.
  if (/prevent all combat damage[^.]*this turn/i.test(line)) {
    if (!DAMAGE_PENDING_STEPS.has(state.step)) return false
    const attacking = Object.values(state.objects).some(
      (candidate) => candidate.zone === 'battlefield' && candidate.attacking,
    )
    if (!attacking) return false
  }
  const manaCost = [...cost.matchAll(/\{(?:\d+|[WUBRGC](?:\/[WUBRGC])?)\}/gi)]
    .map((match) => match[0])
    .join('')
  if (manaCost && !canFund(state, seat, manaCost)) return false
  return true
}

const canPayActivateCosts = (
  state: GameState,
  object: GameObject,
  seat: PlayerId,
  costs: ActivateCost,
) => {
  if (costs.tap && !sourceCanTap(object, seat, state)) return false
  if (costs.mana && !canFund(state, seat, costs.mana)) return false
  if ((costs.life ?? 0) >= state.players[seat].life) return false
  return true
}

const cardRuleActions = (state: GameState, object: GameObject, seat: PlayerId) =>
  effectsOf(object).flatMap((effect): AvailableAction[] => {
    if (object.zone !== 'battlefield' || object.controller !== seat) return []
    if (effect.op === 'activate' && !effect.manaAbility) {
      const loyalty = effect.costs.loyalty
      if (
        !canPayActivateCosts(state, object, seat, effect.costs)
        || !conditionHolds(effect.if, state, object)
        || (
          loyalty !== undefined
          && (
            state.active !== seat
            || !MAIN_STEPS.has(state.step)
            || state.stack.length > 0
            || object.loyaltyActivatedTurn === state.turn
            || (loyalty < 0 && (object.counters.loyalty ?? 0) < -loyalty)
          )
        )
      ) {
        return []
      }
      return [{
        kind: 'activateAbility',
        objectId: object.id,
        name: object.name,
        text: effect.id,
        abilityId: effect.id,
      }]
    }
    if (
      effect.op === 'search'
      && effect.via === 'ability'
      && canPayActivateCosts(state, object, seat, effect.costs)
    ) {
      return [{
        kind: 'activateAbility',
        objectId: object.id,
        name: object.name,
        text: effect.spec.prompt,
        abilityId: 'librarySearch.fetch',
      }]
    }
    return []
  })

/**
 * Enumerate meaningful choices for the seat with priority. Mana abilities are
 * folded into spells they can fund; listing every untapped land as a choice
 * would make an otherwise empty priority window look actionable.
 *
 * Target legality and card-specific restrictions are deliberately
 * conservative: an uncertain action remains listed and therefore causes a
 * stop. The host may auto-pass only when this list is genuinely empty.
 */
export const availableActions = (
  state: GameState,
  seat: PlayerId = state.priority ?? '',
): AvailableAction[] => {
  if (!seat || state.priority !== seat || state.players[seat]?.lost) return []
  if (state.step === 'untap' || state.step === 'cleanup') return []
  const actions: AvailableAction[] = []
  const hand = state.zoneOrder[seat]?.hand ?? []

  if (
    state.active === seat
    && MAIN_STEPS.has(state.step)
    && state.stack.length === 0
    && state.players[seat].landsPlayed < state.players[seat].landPlaysAllowed
  ) {
    for (const id of hand) {
      const object = state.objects[id]
      if (object?.types.includes('Land')) {
        actions.push({ kind: 'playLand', objectId: id, name: object.name })
      }
    }
  }

  for (const object of Object.values(state.objects)) {
    if (canCastNow(state, seat, object)) {
      actions.push({ kind: 'castSpell', objectId: object.id, name: object.name })
    }
    const declaredActions = cardRuleActions(state, object, seat)
    actions.push(...declaredActions)
    if (declaredActions.length === 0) {
      for (const text of activatedText(object)) {
        if (canActivate(state, object, seat, text)) {
          actions.push({
            kind: 'activateAbility',
            objectId: object.id,
            name: object.name,
            text,
          })
        }
      }
    }
  }

  if (state.active === seat && state.step === 'declareAttackers') {
    const objectIds = Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes('Creature')
        && !object.tapped
        && (!object.summoningSickness || hasKeyword(object, 'haste', state)))
      .map((object) => object.id)
    if (objectIds.length > 0) actions.push({ kind: 'declareAttackers', objectIds })
  }

  if (state.step === 'declareBlockers') {
    const attackerIds = Object.values(state.objects)
      .filter((object) => {
        if (object.zone !== 'battlefield' || !object.attacking) return false
        if (typeof object.attacking === 'string') return object.attacking === seat
        if (object.attacking.kind === 'player') return object.attacking.player === seat
        return state.objects[object.attacking.objectId]?.controller === seat
      })
      .map((object) => object.id)
    const objectIds = Object.values(state.objects)
      .filter((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes('Creature')
        && !object.tapped)
      .map((object) => object.id)
    if (attackerIds.length > 0 && objectIds.length > 0) {
      actions.push({ kind: 'declareBlockers', objectIds, attackerIds })
    }
  }

  return actions
}

/**
 * Tap-for-mana buttons for the acting seat. These are UI affordances, not a
 * reason to stop an otherwise empty priority window.
 */
export const manaAffordances = (
  state: GameState,
  seat: PlayerId = state.priority ?? '',
): AvailableAction[] => {
  if (!seat || state.priority !== seat || state.players[seat]?.lost) return []
  if (state.step === 'untap' || state.step === 'cleanup') return []
  const actions: AvailableAction[] = []
  const seen = new Set<string>()
  for (const object of Object.values(state.objects)) {
    if (!sourceCanTap(object, seat, state)) continue
    for (const mode of manaModes(object, state)) {
      const choice = tapChoice(state, object, mode)
      if (!choice) continue
      const key = `${object.id}:${choice.mana ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      actions.push({
        kind: 'tapForMana',
        objectId: object.id,
        name: object.name,
        ...choice,
      })
    }
  }
  return actions
}

const targetVariants = (
  state: GameState,
  seat: PlayerId,
  action: AvailableAction,
): AvailableAction[] => {
  if (action.kind !== 'castSpell') return [action]
  const source = state.objects[action.objectId]
  const targeted = source
    ? effectsOf(source).filter((effect) => effect.op === 'targetedResolve')
    : []
  if (targeted.length !== 1 || !source) return [action]
  const effect = targeted[0]
  return Object.values(state.objects)
    .filter((object) => validTarget(state, object, effect.filter, seat))
    .map((target) => ({
      ...action,
      targetObjectId: target.id,
      targetName: target.name,
    }))
}

const activationTargetGroups = (
  state: GameState,
  action: AvailableAction,
): AvailableAction => {
  if (action.kind !== 'activateAbility' || !action.abilityId) return action
  const source = state.objects[action.objectId]
  const effect = source
    ? activateEffect(effectsOf(source), action.abilityId)
    : undefined
  if (effect?.targets !== 'teferiSunsetPlusOne') return action
  const targets = Object.values(state.objects).filter((object) => object.zone === 'battlefield')
  return {
    ...action,
    targetGroups: ['Artifact', 'Creature', 'Land'].map((type) => ({
      label: type,
      min: 0,
      max: 1,
      targets: targets
        .filter((object) => object.types.includes(type))
        .map((object) => ({
          objectId: object.id,
          name: object.name,
          controller: object.controller,
        })),
    })),
  }
}

export const legalActsFor = (
  state: GameState,
  seat: PlayerId = state.priority ?? '',
): AvailableAction[] =>
  [...availableActions(state, seat), ...manaAffordances(state, seat)]
    .flatMap((action) => targetVariants(state, seat, action))
    .map((action) => activationTargetGroups(state, action))
    .filter((action) =>
      action.kind === 'declareAttackers'
      || action.kind === 'declareBlockers'
      || (action.kind === 'activateAbility' && Boolean(action.targetGroups))
      || eventsForAvailableAction(state, seat, action))

export const sameLegalAct = (
  left: AvailableAction,
  right: {
    kind?: string
    objectId?: string
    abilityId?: string
    text?: string
    mana?: ManaId
    targetObjectId?: string
  },
) => {
  if (left.kind !== right.kind) return false
  if ('objectId' in left && left.objectId !== right.objectId) return false
  if (left.kind === 'tapForMana') return left.mana === right.mana
  if (left.kind === 'activateAbility') {
    return left.abilityId === right.abilityId && left.text === right.text
  }
  if (left.kind === 'castSpell') return left.targetObjectId === right.targetObjectId
  return true
}

const SIMPLE_PERMANENT = new Set<string>(PERMANENT_TYPES)

const fundingEvents = (
  state: GameState,
  seat: PlayerId,
  cost: string,
): GameEvent[] | null => {
  const sources = Object.values(state.objects)
    .filter((object) => sourceCanTap(object, seat, state))
    .map((source) => ({ source, modes: manaModes(source, state) }))
    .filter(({ modes }) => modes.length > 0)
  let plans = [{
    pool: state.players[seat]?.mana ?? emptyMana(),
    events: [] as GameEvent[],
  }]
  for (const { source, modes } of sources) {
    const next = new Map<string, typeof plans[number]>()
    for (const plan of plans) {
      const candidates = [
        plan,
        ...modes.flatMap((mode) => {
          const choice = tapChoice(state, source, mode)
          if (!choice) return []
          return [{
            pool: addPool(plan.pool, mode),
            events: [
              ...plan.events,
              { type: 'tapForMana', seat, objectId: source.id, ...choice } as GameEvent,
            ],
          }]
        }),
      ]
      for (const candidate of candidates) {
        const key = poolKey(candidate.pool, 20)
        const previous = next.get(key)
        if (!previous || candidate.events.length < previous.events.length) {
          next.set(key, candidate)
        }
      }
    }
    plans = [...next.values()]
  }
  return plans
    .filter((plan) => payCost(plan.pool, cost))
    .sort((left, right) => left.events.length - right.events.length)[0]
    ?.events ?? null
}

/**
 * Turn an enumerated, choice-free action into reducer events. Returning null
 * is deliberate: targets, optional costs, ETB choices, and spell instructions
 * still need a card handler or the judge.
 */
export const eventsForAvailableAction = (
  state: GameState,
  seat: PlayerId,
  action: AvailableAction,
): GameEvent[] | null => {
  if (action.kind === 'playLand') {
    return [{ type: 'playLand', seat, objectId: action.objectId }]
  }
  if (action.kind === 'tapForMana') {
    return [{
      type: 'tapForMana',
      seat,
      objectId: action.objectId,
      ...(action.mana ? { mana: action.mana } : {}),
    }]
  }
  if (action.kind === 'activateAbility') {
    const object = state.objects[action.objectId]
    if (!object || !action.abilityId) return null
    const effect = effectsOf(object).find(
      (candidate): candidate is Extract<ReturnType<typeof effectsOf>[number], { op: 'activate' }> =>
      candidate.op === 'activate'
      && candidate.id === action.abilityId
      && !candidate.targets,
    )
    return effect && !effect.costs.loyaltyX
      ? [{
          type: 'activateAbility',
          abilityId: effect.id,
          seat,
          objectId: object.id,
        }]
      : null
  }
  if (action.kind !== 'castSpell') return null
  const object = state.objects[action.objectId]
  const targeted = object
    ? effectsOf(object).filter((effect) => effect.op === 'targetedResolve')
    : []
  const resolvesThroughKernel = object
    ? effectsOf(object).some((effect) =>
      (effect.op === 'trigger' && effect.on === 'resolve')
      || (effect.op === 'search' && effect.via === 'spell'))
    : false
  if (
    !object
    || (
      targeted.length === 0
      && !object.types.some((type) => SIMPLE_PERMANENT.has(type))
      && !resolvesThroughKernel
    )
    || targeted.length > 1
    || (targeted.length === 0 && /\btarget\b/i.test(object.oracleText))
    || /(?:additional cost|enters(?: the battlefield)?|when you cast|choose)/i
      .test(object.oracleText)
  ) {
    return null
  }
  if (targeted.length === 1 && !action.targetObjectId) return null
  const tax = taxFor(state, seat, object)
  const cost = `${object.manaCost}${tax > 0 ? `{${tax}}` : ''}`
  const mana = fundingEvents(state, seat, cost)
  if (!mana) return null
  return [
    ...mana,
    {
      type: 'castSpell',
      seat,
      objectId: object.id,
      ...(action.targetObjectId
        ? { targets: [{ kind: 'object' as const, objectId: action.targetObjectId }] }
        : {}),
    },
  ]
}
