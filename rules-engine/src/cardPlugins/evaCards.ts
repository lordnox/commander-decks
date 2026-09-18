import { openCardSelection } from '../rules/selectCards'
import { initiateDiscard } from '../rules/discard'
import { payCost } from '../plugins/spells'
import type { GameObject, GameState, PlayerId, Plugin, StackItem } from '../types'
import { applyCopy, createToken } from './effects'

const TURN = {
  batwingFog: 'eva.batwingFogTurn',
  comeuppance: 'eva.comeuppanceTurn',
  everybody: 'eva.everybodyLivesTurn',
  inkshield: 'eva.inkshieldTurn',
} as const

const sourceOf = (state: GameState, item: StackItem) => state.objects[item.objectId]

const playerTarget = (item: StackItem) =>
  item.targets.find((target) => target.kind === 'player')?.player

const objectTarget = (state: GameState, item: StackItem, index = 0) => {
  const target = item.targets[index]
  return target?.kind === 'object' ? state.objects[target.objectId] : undefined
}

const opponentsOf = (state: GameState, seat: PlayerId) =>
  state.playerOrder.filter((other) => other !== seat && !state.players[other].lost)

const copyToken = (draft: Parameters<typeof createToken>[0], seat: PlayerId, copied: GameObject) =>
  createToken(draft, seat, {
    name: copied.name,
    types: [...copied.types],
    subtypes: [...copied.subtypes],
    supertypes: [...copied.supertypes],
    colors: [...copied.colors],
    manaCost: copied.manaCost,
    power: copied.power,
    toughness: copied.toughness,
    oracleText: copied.oracleText,
    grantedRules: [...copied.grantedRules],
    tapProduces: copied.tapProduces ? { ...copied.tapProduces } : undefined,
    effects: copied.effects ? [...copied.effects] : [],
  })

const setTurnFlag = (
  draft: Parameters<typeof createToken>[0],
  seats: PlayerId[],
  key: string,
) => {
  for (const seat of seats) draft.players[seat].data[key] = draft.turn
}

const drainOpponents = (
  draft: Parameters<typeof createToken>[0],
  controller: PlayerId,
  amount: number,
  sourceId: string,
) => {
  const opponents = opponentsOf(draft, controller)
  for (const seat of opponents) {
    draft.enqueue({ type: 'loseLife', seat, amount, source: sourceId })
  }
  draft.enqueue({
    type: 'gainLife',
    seat: controller,
    amount: amount * opponents.length,
    source: sourceId,
  })
}

const resolveBlink = (
  draft: Parameters<typeof createToken>[0],
  item: StackItem,
  source: GameObject,
) => {
  const delayed = source.name === 'Vanish into Memory'
  for (const target of item.targets) {
    if (target.kind !== 'object') continue
    const object = draft.object(target.objectId)
    if (!object || object.zone !== 'battlefield') continue
    if (delayed) {
      draft.enqueue({ type: 'draw', seat: source.controller, count: Math.max(0, object.power ?? 0) })
      draft.players[source.controller].data['eva.vanishReturn'] = {
        objectId: object.id,
        toughness: Math.max(0, object.toughness ?? 0),
      }
      draft.enqueue({ type: 'move', objectId: object.id, to: 'exile' })
      continue
    }
    draft.enqueue({ type: 'move', objectId: object.id, to: 'exile' })
    draft.enqueue({
      type: 'move',
      objectId: object.id,
      to: 'battlefield',
      controller: source.name === 'Ghostly Flicker' ? source.controller : object.owner,
    })
    draft.enqueue({ type: 'untap', objectId: object.id })
  }
}

const resolveSpell = (
  state: GameState,
  draft: Parameters<typeof createToken>[0],
  item: StackItem,
  source: GameObject,
) => {
  const controller = item.controller
  if (source.name === 'Batwing Brume') {
    if (item.manaSpent?.includes('W')) {
      setTurnFlag(draft, [...draft.playerOrder], TURN.batwingFog)
    }
    if (item.manaSpent?.includes('B')) {
      for (const seat of draft.playerOrder) {
        const count = Object.values(draft.objects).filter((object) =>
          object.zone === 'battlefield'
          && object.controller === seat
          && object.attacking !== null).length
        if (count > 0) draft.enqueue({ type: 'loseLife', seat, amount: count, source: source.id })
      }
    }
    return
  }
  if (source.name === 'Comeuppance') {
    setTurnFlag(draft, [controller], TURN.comeuppance)
    return
  }
  if (source.name === 'Everybody Lives!') {
    setTurnFlag(draft, [...draft.playerOrder], TURN.everybody)
    return
  }
  if (source.name === 'Inkshield') {
    setTurnFlag(draft, [controller], TURN.inkshield)
    return
  }
  if (source.name === 'Energy Arc') {
    const ids: string[] = []
    for (const target of item.targets) {
      if (target.kind !== 'object') continue
      const creature = draft.object(target.objectId)
      if (!creature?.types.includes('Creature')) continue
      creature.tapped = false
      ids.push(creature.id)
    }
    draft.players[controller].data['eva.energyArc'] = { turn: draft.turn, ids }
    return
  }
  if (source.name === 'Settle the Wreckage') {
    const seat = playerTarget(item)
    if (!seat) return
    const attackers = Object.values(draft.objects).filter((object) =>
      object.zone === 'battlefield'
      && object.controller === seat
      && object.attacking !== null)
    for (const attacker of attackers) {
      draft.enqueue({ type: 'move', objectId: attacker.id, to: 'exile' })
    }
    const basics = draft.zoneOrder[seat].library.filter((objectId) => {
      const object = draft.object(objectId)
      return object?.types.includes('Land') && object.supertypes.includes('Basic')
    })
    openCardSelection(draft, {
      seat,
      kind: 'search',
      count: attackers.length,
      min: 0,
      candidates: basics,
      sourceId: source.id,
      source: source.name,
      prompt: `Search for up to ${attackers.length} basic lands.`,
      destinations: ['battlefield'],
      fromSeat: seat,
      tapped: true,
    })
    return
  }
  if (source.name === "Council's Judgment") {
    const voters = [
      controller,
      ...draft.playerOrder.filter((seat) => seat !== controller && !draft.players[seat].lost),
    ]
    draft.players[controller].data['eva.council'] = {
      sourceId: source.id,
      voters,
      votes: {},
    }
    draft.priority = voters[0]
    return
  }
  if (source.name === 'Fractured Identity') {
    const target = objectTarget(state, item)
    if (!target || target.zone !== 'battlefield' || target.types.includes('Land')) return
    const previousController = target.controller
    draft.enqueue({ type: 'move', objectId: target.id, to: 'exile' })
    for (const seat of draft.playerOrder) {
      if (seat !== previousController && !draft.players[seat].lost) copyToken(draft, seat, target)
    }
    return
  }
  if (source.name === 'Mirrorweave') {
    const copied = objectTarget(state, item)
    if (!copied || copied.supertypes.includes('Legendary')) return
    const snapshots: GameObject[] = []
    for (const creature of Object.values(draft.objects)) {
      if (
        creature.zone === 'battlefield'
        && creature.types.includes('Creature')
        && creature.id !== copied.id
      ) {
        snapshots.push(structuredClone(creature))
        applyCopy(creature, copied)
      }
    }
    draft.players[controller].data['eva.mirrorweave'] = { turn: draft.turn, snapshots }
    return
  }
  if (source.name === 'Debt to the Deathless' || source.name === 'Exsanguinate') {
    drainOpponents(
      draft,
      controller,
      (item.x ?? 0) * (source.name === 'Debt to the Deathless' ? 2 : 1),
      source.id,
    )
    return
  }
  if (source.name === 'Drain Life') {
    const target = item.targets[0]
    const amount = Math.max(0, item.x ?? 0)
    if (!target) return
    draft.enqueue({ type: 'dealDamage', sourceId: source.id, target, amount })
    draft.enqueue({ type: 'gainLife', seat: controller, amount, source: source.id })
    return
  }
  if (source.name === 'Repay in Kind') {
    const lowest = Math.min(...Object.values(draft.players)
      .filter((player) => !player.lost)
      .map((player) => player.life))
    for (const player of Object.values(draft.players)) player.life = lowest
    return
  }
  if (
    source.name === 'Ephemerate'
    || source.name === 'Ghostly Flicker'
    || source.name === 'Vanish into Memory'
  ) {
    resolveBlink(draft, item, source)
    return
  }
  if (source.name === 'Snuff Out') {
    const target = objectTarget(state, item)
    if (target) draft.enqueue({ type: 'move', objectId: target.id, to: 'graveyard' })
    return
  }
  if (source.name === 'Loran of the Third Path') {
    const target = objectTarget(state, item)
    if (
      target
      && target.zone === 'battlefield'
      && (target.types.includes('Artifact') || target.types.includes('Enchantment'))
    ) {
      draft.enqueue({ type: 'move', objectId: target.id, to: 'graveyard' })
    }
    return
  }
  if (source.name === 'Mister Negative') {
    const seat = playerTarget(item)
    if (!seat) return
    const before = draft.players[controller].life
    const other = draft.players[seat].life
    draft.players[controller].life = other
    draft.players[seat].life = before
    if (before > other) draft.enqueue({ type: 'draw', seat: controller, count: before - other })
  }
}

const replacement: Plugin['replace'] = ({ state, event }) => {
  if (event.type === 'draw' && !event.phialReplacement) {
    const phial = Object.values(state.objects).some((object) =>
      object.zone === 'battlefield'
      && object.controller === event.seat
      && object.name === 'Phial of Galadriel')
    if (phial && state.zoneOrder[event.seat].hand.length === 0) {
      return [
        { ...event, count: 1, phialReplacement: true },
        { ...event, count: 1, phialReplacement: true },
      ]
    }
  }
  if (event.type === 'gainLife' && !event.phialReplacement) {
    const phial = Object.values(state.objects).some((object) =>
      object.zone === 'battlefield'
      && object.controller === event.seat
      && object.name === 'Phial of Galadriel')
    if (phial && state.players[event.seat].life <= 5) {
      return { ...event, amount: event.amount * 2, phialReplacement: true }
    }
  }
  if (
    event.type === 'loseLife'
    && Object.values(state.players).some((player) => player.data[TURN.everybody] === state.turn)
  ) return null

  if (event.type !== 'combatDamage' && event.type !== 'dealDamage') return
  const source = state.objects[event.sourceId]
  const targetController = event.target.kind === 'player'
    ? event.target.player
    : state.objects[event.target.objectId]?.controller
  if (!targetController) return

  const energy = Object.values(state.players)
    .map((player) => player.data['eva.energyArc'])
    .find((entry) =>
      entry
      && typeof entry === 'object'
      && (entry as { turn?: number }).turn === state.turn
      && Array.isArray((entry as { ids?: unknown }).ids)
      && (
        (entry as { ids: unknown[] }).ids.includes(event.sourceId)
        || (
          event.target.kind === 'object'
          && (entry as { ids: unknown[] }).ids.includes(event.target.objectId)
        )
      ))
  if (
    event.type === 'combatDamage'
    && energy
  ) return null

  for (const player of Object.values(state.players)) {
    const dialogue = player.data['eva.sokrates']
    if (
      event.type === 'combatDamage'
      && dialogue
      && typeof dialogue === 'object'
      && (dialogue as { turn?: number }).turn === state.turn
      && (dialogue as { objectId?: string }).objectId === event.sourceId
      && event.target.kind === 'player'
    ) {
      const count = Math.floor(event.amount / 2)
      const controller = source?.controller
      if (!controller || count === 0) return null
      return [
        { type: 'draw', seat: controller, count },
        { type: 'draw', seat: event.target.player, count },
      ]
    }
  }

  const defended = state.players[targetController]
  if (
    event.type === 'combatDamage'
    && defended.data[TURN.batwingFog] === state.turn
  ) return null

  if (
    event.type === 'combatDamage'
    && defended.data[TURN.inkshield] === state.turn
    && event.target.kind === 'player'
  ) {
    return [{
      type: 'createTokens',
      seat: targetController,
      count: event.amount,
      source: 'Inkshield',
      token: {
        name: 'Inkling',
        types: ['Creature'],
        subtypes: ['Inkling'],
        colors: ['W', 'B'],
        power: 2,
        toughness: 1,
        oracleText: 'Flying',
      },
    }]
  }

  if (
    event.type === 'dealDamage'
    && defended.data[TURN.comeuppance] === state.turn
    && source?.controller !== targetController
  ) {
    if (source?.types.includes('Creature')) {
      return [{
        type: 'dealDamage',
        sourceId: 'Comeuppance',
        target: { kind: 'object', objectId: source.id },
        amount: event.amount,
      }]
    }
    if (source?.controller) {
      return [{
        type: 'dealDamage',
        sourceId: 'Comeuppance',
        target: { kind: 'player', player: source.controller },
        amount: event.amount,
      }]
    }
    return null
  }
}

const findCouncil = (state: GameState, sourceId: string) =>
  Object.values(state.players).map((player) => ({
    controller: player.id,
    value: player.data['eva.council'],
  })).find(({ value }) =>
    value
    && typeof value === 'object'
    && (value as { sourceId?: string }).sourceId === sourceId)

const legal: Plugin['legal'] = ({ state, event }) => {
  if (event.type === 'castSpell' || event.type === 'activateAbility') {
    const controller = event.seat
    const everybodyLives = Object.values(state.players).some(
      (player) => player.data[TURN.everybody] === state.turn,
    )
    for (const target of event.targets ?? []) {
      if (target.kind === 'player') {
        if (everybodyLives && target.player !== controller) {
          return `${target.player} has hexproof`
        }
        continue
      }
      const object = state.objects[target.objectId]
      if (!object || object.controller === controller) continue
      if (everybodyLives && object.types.includes('Creature')) {
        return `${object.name} has hexproof`
      }
      if (object.name === 'Sokrates, Athenian Teacher' && !object.tapped) {
        return 'Sokrates has hexproof while untapped'
      }
    }
  }
  if (event.type === 'vote') {
    const council = findCouncil(state, event.sourceId)
    if (!council) return 'no Council’s Judgment vote is open'
    const value = council.value as { voters: string[]; votes: Record<string, string> }
    const next = value.voters.find((seat) => !value.votes[seat])
    if (event.seat !== next) return `${next} votes next`
    const target = state.objects[event.objectId]
    if (
      !target
      || target.zone !== 'battlefield'
      || target.types.includes('Land')
      || target.controller === council.controller
    ) return 'illegal Council’s Judgment vote'
    return
  }
  if (event.type === 'activateAbility' && event.copyWithRings) {
    if (event.manaAbility) return 'Rings of Brighthearth cannot copy mana abilities'
    const rings = Object.values(state.objects).some((object) =>
      object.zone === 'battlefield'
      && object.controller === event.seat
      && object.name === 'Rings of Brighthearth')
    if (!rings) return `${event.seat} does not control Rings of Brighthearth`
    if (!payCost(state.players[event.seat].mana, '{2}')) return 'not enough mana for Rings'
  }
  if (event.type === 'activateAbility') {
    const source = state.objects[event.objectId]
    if (source?.name === 'Mirror Universe') {
      if (state.active !== event.seat || state.step !== 'upkeep') {
        return 'Mirror Universe can be activated only during your upkeep'
      }
      const target = event.targets?.[0]
      if (target?.kind !== 'player' || target.player === event.seat) {
        return 'Mirror Universe requires an opponent target'
      }
    }
    if (source?.name === 'Loran of the Third Path') {
      const target = event.targets?.[0]
      if (target?.kind !== 'player' || target.player === event.seat) {
        return 'Loran requires an opponent target'
      }
    }
    if (source?.name === 'Sokrates, Athenian Teacher') {
      const target = event.targets?.[0]
      const creature = target?.kind === 'object' ? state.objects[target.objectId] : undefined
      if (!creature?.types.includes('Creature')) return 'Sokrates requires a creature target'
    }
  }
  if (event.type !== 'castSpell') return
  const source = state.objects[event.objectId]
  if (!source) return
  if (source.name === 'Snuff Out') {
    const target = event.targets?.[0]
    const creature = target?.kind === 'object' ? state.objects[target.objectId] : undefined
    if (!creature?.types.includes('Creature') || creature.colors.includes('B')) {
      return 'Snuff Out requires a nonblack creature target'
    }
  }
  if (source.name === 'Settle the Wreckage') {
    const target = event.targets?.[0]
    if (target?.kind !== 'player') return 'Settle the Wreckage requires a player target'
  }
  if (source.name === 'Fractured Identity') {
    const target = event.targets?.[0]
    const permanent = target?.kind === 'object' ? state.objects[target.objectId] : undefined
    if (!permanent || permanent.zone !== 'battlefield' || permanent.types.includes('Land')) {
      return 'Fractured Identity requires a nonland permanent target'
    }
  }
  if (source.name === 'Mirrorweave') {
    const target = event.targets?.[0]
    const creature = target?.kind === 'object' ? state.objects[target.objectId] : undefined
    if (!creature?.types.includes('Creature') || creature.supertypes.includes('Legendary')) {
      return 'Mirrorweave requires a nonlegendary creature target'
    }
  }
}

const apply: Plugin['apply'] = ({ state, event, draft }) => {
  if (event.type === 'createTokens') {
    for (let index = 0; index < event.count; index += 1) {
      createToken(draft, event.seat, {
        name: event.token.name,
        types: event.token.types,
        subtypes: event.token.subtypes ?? [],
        colors: event.token.colors ?? [],
        power: event.token.power ?? null,
        toughness: event.token.toughness ?? null,
        oracleText: event.token.oracleText ?? '',
      })
    }
    return
  }

  if (event.type === 'draw') {
    const protectedPlayer = draft.players[event.seat]
    if (protectedPlayer.data[TURN.everybody] === draft.turn) protectedPlayer.lost = false
    if (protectedPlayer.lost) return
    for (const queza of Object.values(draft.objects)) {
      if (
        queza.zone !== 'battlefield'
        || queza.controller !== event.seat
        || queza.name !== 'Queza, Augur of Agonies'
      ) continue
      const opponent = opponentsOf(draft, queza.controller)[0]
      if (!opponent) continue
      draft.addTriggeredAbility(queza, [], {
        targets: [{ kind: 'player', player: opponent }],
        payload: { evaKind: 'queza' },
        name: queza.name,
      })
    }
    return
  }

  if (event.type === 'vote') {
    const council = findCouncil(state, event.sourceId)
    if (!council) return
    const value = structuredClone(council.value) as {
      voters: string[]
      votes: Record<string, string>
      sourceId: string
    }
    value.votes[event.seat] = event.objectId
    const next = value.voters.find((seat) => !value.votes[seat])
    if (next) {
      draft.players[council.controller].data['eva.council'] = value
      draft.priority = next
      return
    }
    const totals = Object.values(value.votes).reduce<Record<string, number>>((counts, objectId) => {
      counts[objectId] = (counts[objectId] ?? 0) + 1
      return counts
    }, {})
    const most = Math.max(...Object.values(totals))
    for (const [objectId, count] of Object.entries(totals)) {
      if (count === most) draft.enqueue({ type: 'move', objectId, to: 'exile' })
    }
    delete draft.players[council.controller].data['eva.council']
    draft.priority = draft.active
    return
  }

  if (event.type === 'activateAbility' && event.copyWithRings && !event.manaAbility) {
    const paid = payCost(draft.players[event.seat].mana, '{2}')
    const original = draft.stack[0]
    if (!paid || !original || original.kind !== 'ability') return
    draft.players[event.seat].mana = paid
    draft.stack.unshift({
      ...structuredClone(original),
      id: draft.allocId('s'),
      targets: event.targets ?? original.targets,
    })
    draft.note(`Rings of Brighthearth copies ${original.name}`)
    return
  }

  if (event.type === 'castSpell') {
    const spell = draft.object(event.objectId)
    if (!spell) return
    const castCountKey = 'eva.spellsCast'
    const record = draft.players[event.seat].data[castCountKey]
    const count = record && typeof record === 'object' && (record as { turn?: number }).turn === draft.turn
      ? Number((record as { count?: number }).count ?? 0) + 1
      : 1
    draft.players[event.seat].data[castCountKey] = { turn: draft.turn, count }
    if (count === 2) {
      for (const lotho of Object.values(draft.objects)) {
        if (lotho.zone !== 'battlefield' || lotho.name !== 'Lotho, Corrupt Shirriff') continue
        draft.addTriggeredAbility(lotho, [], {
          payload: { evaKind: 'lotho' },
          name: lotho.name,
        })
      }
    }
    if (event.payExtort) {
      for (const ghast of Object.values(draft.objects)) {
        if (
          ghast.zone !== 'battlefield'
          || ghast.controller !== event.seat
          || ghast.name !== 'Crypt Ghast'
        ) continue
        const paid = payCost(draft.players[event.seat].mana, '{W/B}')
        if (!paid) continue
        draft.players[event.seat].mana = paid
        drainOpponents(draft, event.seat, 1, ghast.id)
      }
    }
    return
  }

  if (event.type === 'resolveTop') {
    const item = state.stack[0]
    if (!item) return
    const evaKind = item.payload?.evaKind
    if (evaKind === 'lotho') {
      draft.enqueue({ type: 'loseLife', seat: item.controller, amount: 1, source: item.objectId })
      draft.enqueue({
        type: 'createTokens',
        seat: item.controller,
        count: 1,
        token: { name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'] },
        source: item.objectId,
      })
      return
    }
    if (evaKind === 'queza') {
      const target = item.targets[0]
      if (target?.kind === 'player') {
        draft.enqueue({ type: 'loseLife', seat: target.player, amount: 1, source: item.objectId })
        draft.enqueue({ type: 'gainLife', seat: item.controller, amount: 1, source: item.objectId })
      }
      return
    }
    const source = sourceOf(state, item)
    if (!source) return
    if (item.kind === 'spell') resolveSpell(state, draft, item, source)
    if (item.kind === 'ability' && source.name === 'Sokrates, Athenian Teacher') {
      const target = item.targets[0]
      if (target?.kind === 'object') {
        draft.players[item.controller].data['eva.sokrates'] = {
          turn: draft.turn,
          objectId: target.objectId,
        }
      }
    }
    if (item.kind === 'ability' && source.name === 'Loran of the Third Path') {
      const seat = playerTarget(item)
      if (seat) {
        draft.enqueue({ type: 'draw', seat: item.controller, count: 1 })
        draft.enqueue({ type: 'draw', seat, count: 1 })
      }
    }
    if (item.kind === 'ability' && source.name === 'Mirror Universe') {
      const seat = playerTarget(item)
      if (seat) {
        const life = draft.players[item.controller].life
        draft.players[item.controller].life = draft.players[seat].life
        draft.players[seat].life = life
      }
    }
    return
  }

  if (
    event.type === 'custom'
    && event.name === 'advanceStep'
  ) {
    if (draft.step === 'cleanup') {
      for (const player of Object.values(draft.players)) {
        const mirrorweave = player.data['eva.mirrorweave']
        if (!mirrorweave || typeof mirrorweave !== 'object') continue
        const snapshots = (mirrorweave as { snapshots?: GameObject[] }).snapshots
        for (const snapshot of snapshots ?? []) {
          const object = draft.object(snapshot.id)
          if (!object || object.zone !== 'battlefield') continue
          const liveState = {
            zone: object.zone,
            controller: object.controller,
            tapped: object.tapped,
            damageMarked: object.damageMarked,
            counters: object.counters,
            attacking: object.attacking,
            blocking: object.blocking,
          }
          Object.assign(object, structuredClone(snapshot), liveState)
        }
        delete player.data['eva.mirrorweave']
      }
    }
    if (draft.step !== 'upkeep') return
    for (const player of Object.values(draft.players)) {
      if (player.id !== draft.active) continue
      const delayed = player.data['eva.vanishReturn']
      if (!delayed || typeof delayed !== 'object') continue
      const objectId = (delayed as { objectId?: string }).objectId
      const toughness = (delayed as { toughness?: number }).toughness ?? 0
      if (objectId && draft.object(objectId)?.zone === 'exile') {
        draft.enqueue({ type: 'move', objectId, to: 'battlefield' })
        if (toughness > 0) {
          initiateDiscard(draft, {
            seat: player.id,
            count: toughness,
            chooser: player.id,
            sourceId: objectId,
            name: 'Vanish into Memory',
          })
        }
      }
      delete player.data['eva.vanishReturn']
    }
  }
}

export const evaCards: Plugin = {
  id: 'evaCards',
  legal,
  replace: replacement,
  apply,
}
