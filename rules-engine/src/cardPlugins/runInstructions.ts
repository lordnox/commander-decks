import type Draft from '../draft'
import { DIALOG_CHOSEN, openSourceDialog, setPendingDialog } from '../pendingDialog'
import { initiateDiscard } from '../rules/discard'
import { apnapSeats } from '../turnOrder'
import type { GameObject, StackItem } from '../types'
import {
  addPlusCounters,
  applyCopy,
  conditionHolds,
  createToken,
  millLibrary,
  returnOwnedLands,
  type CardInstruction,
} from './effects'

const manaValueOf = (object: GameObject) =>
  object.manaCost
    ? [...object.manaCost.matchAll(/\{([^}]+)\}/g)].reduce((total, match) => {
      if (/^\d+$/.test(match[1])) return total + Number(match[1])
      return match[1] === 'X' ? total : total + 1
    }, 0)
    : object.manaValue ?? 0

function copyTemplate (
  card: GameObject,
  extra: { notLegendary?: boolean; flying?: boolean } = {},
): Partial<GameObject> & { name: string } {
  return {
    name: card.name,
    summoningSickness: card.types.includes('Creature'),
    types: [...card.types],
    subtypes: [...card.subtypes],
    supertypes: extra.notLegendary
      ? card.supertypes.filter((entry) => entry !== 'Legendary')
      : [...card.supertypes],
    manaCost: card.manaCost,
    power: card.power,
    toughness: card.toughness,
    oracleText: extra.flying && !card.oracleText.toLowerCase().includes('flying')
      ? `${card.oracleText}\nFlying`
      : card.oracleText,
    grantedRules: [...card.grantedRules],
    tapProduces: card.tapProduces ? { ...card.tapProduces } : undefined,
    effects: card.effects ? [...card.effects] : [],
  }
}

type BufferedStackAction =
  | { kind: 'draw'; remaining: number }
  | { kind: 'discard'; count: number; who?: 'controller' | 'target' }

const discardSeatFor = (
  source: GameObject,
  item?: StackItem,
  who: 'controller' | 'target' = 'controller',
) => {
  if (who === 'target') {
    const target = item?.targets[0]
    if (target?.kind === 'player') return target.player
  }
  return source.controller
}

const flushStackActions = (
  draft: Draft,
  source: GameObject,
  buffer: BufferedStackAction[],
  item?: StackItem,
) => {
  for (const action of [...buffer].reverse()) {
    if (action.kind === 'draw') {
      draft.enqueue({
        type: 'draw',
        seat: source.controller,
        count: action.remaining,
      })
      continue
    }
    const seat = discardSeatFor(source, item, action.who)
    initiateDiscard(draft, {
      seat,
      count: action.count,
      chooser: seat,
      sourceId: source.id,
      name: source.name,
    })
  }
}

const askEachPlayerChoice = (
  draft: Draft,
  source: GameObject,
  kind: 'discard-card' | 'sacrifice-creature',
) => {
  const discard = kind === 'discard-card'
  for (const seat of apnapSeats(draft)) {
    const hasChoice = discard
      ? draft.zoneOrder[seat].hand.length > 0
      : Object.values(draft.objects).some((object) =>
        object.zone === 'battlefield'
        && object.controller === seat
        && object.types.includes('Creature'))
    if (!hasChoice) continue
    openSourceDialog(draft, source, {
      seat,
      kind,
      prompt: discard
        ? `${source.name} makes each player discard a card. Choose one.`
        : `${source.name} makes each player sacrifice a creature. Choose one.`,
      waiting: discard
        ? 'is choosing a card to discard.'
        : 'is choosing a creature to sacrifice.',
      judge: `${source.name}: ${
        discard ? 'each player discards' : 'each player sacrifices a creature'
      }.`,
      destinations: discard ? ['hand', 'graveyard'] : ['battlefield', 'sacrifice'],
      requirements: discard
        ? { graveyard: { min: 1, max: 1 } }
        : { sacrifice: { min: 1, max: 1 } },
      count: 1,
    })
  }
}

export const runInstructions = (
  draft: Draft,
  source: GameObject,
  instructions: CardInstruction[],
  item?: StackItem,
  stackBuffer?: BufferedStackAction[],
) => {
  const buffer = stackBuffer ?? (item ? [] as BufferedStackAction[] : undefined)

  for (const instruction of instructions) {
    if (instruction.kind === 'if') {
      const live = draft.object(source.id) ?? source
      const chosen = conditionHolds(instruction.if, draft, live)
        ? instruction.whenTrue
        : instruction.whenFalse ?? []
      runInstructions(draft, source, chosen, item, buffer)
      continue
    }
    if (instruction.kind === 'selfMill') {
      millLibrary(draft, source.controller, instruction.count)
      continue
    }
    if (instruction.kind === 'bounceSelf') {
      draft.enqueue({ type: 'move', objectId: source.id, to: 'hand' })
      continue
    }
    if (instruction.kind === 'tap') {
      draft.enqueue({ type: 'tap', objectId: source.id })
      continue
    }
    if (instruction.kind === 'payMana') {
      draft.enqueue({ type: 'payMana', seat: source.controller, cost: instruction.cost })
      continue
    }
    if (instruction.kind === 'sacrificeSelf') {
      draft.enqueue({ type: 'move', objectId: source.id, to: 'graveyard' })
      continue
    }
    if (instruction.kind === 'addMana') {
      draft.enqueue({ type: 'addMana', seat: source.controller, mana: instruction.mana })
      continue
    }
    if (instruction.kind === 'addManaToEachPlayer') {
      for (const player of Object.values(draft.players)) {
        draft.enqueue({ type: 'addMana', seat: player.id, mana: instruction.mana })
      }
      continue
    }
    if (instruction.kind === 'draw') {
      if (buffer) {
        buffer.push({ kind: 'draw', remaining: instruction.count })
        continue
      }
      draft.enqueue({ type: 'draw', seat: source.controller, count: instruction.count })
      continue
    }
    if (instruction.kind === 'discardCards') {
      const seat = discardSeatFor(source, item, instruction.who)
      if (buffer) {
        buffer.push({ kind: 'discard', count: instruction.count, who: instruction.who })
        continue
      }
      initiateDiscard(draft, {
        seat,
        count: instruction.count,
        chooser: seat,
        sourceId: source.id,
        name: source.name,
      })
      continue
    }
    if (instruction.kind === 'gainLife') {
      draft.players[source.controller].life += instruction.count
      continue
    }
    if (instruction.kind === 'loseLife') {
      const seat = instruction.who === 'controller'
        ? source.controller
        : typeof item?.payload?.triggeringPlayer === 'string'
          ? item.payload.triggeringPlayer
          : source.controller
      draft.enqueue({
        type: 'loseLife',
        seat,
        amount: instruction.amount,
        source: source.id,
      })
      continue
    }
    if (instruction.kind === 'loseLifeTargetManaValue') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      const object = draft.object(target.objectId)
      if (!object) continue
      draft.players[source.controller].life -= manaValueOf(object)
      continue
    }
    if (instruction.kind === 'teferiSunsetPlusOne') {
      for (const target of item?.targets ?? []) {
        if (target.kind !== 'object') continue
        const object = draft.object(target.objectId)
        if (!object || object.zone !== 'battlefield') continue
        draft.enqueue({
          type: object.controller === source.controller ? 'untap' : 'tap',
          objectId: object.id,
        })
      }
      draft.players[source.controller].life += 2
      continue
    }
    if (instruction.kind === 'lookTopChooseOne') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'look-top',
        prompt: `Look at the top ${instruction.count} cards. Put one into your hand and the rest on the bottom in any order.`,
        waiting: 'is making a private top-card choice.',
        judge: 'Waiting for a private top-card choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['bottom', 'hand'],
        count: instruction.count,
        requirements: { hand: { min: 1, max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'teferiSunsetEmblem') {
      draft.enqueue({
        type: 'custom',
        name: 'teferiSunset.emblem',
        seat: source.controller,
      })
      continue
    }
    if (instruction.kind === 'dealDamageToChosenTarget') {
      const target = item?.targets[0]
      if (target) {
        draft.enqueue({
          type: 'dealDamage',
          sourceId: source.id,
          target,
          amount: instruction.amount,
        })
      }
      continue
    }
    if (instruction.kind === 'exileColoredPermanentsAtMostX') {
      const x = item?.x ?? 0
      for (const object of Object.values(draft.objects)) {
        if (
          object.zone === 'battlefield'
          && object.colors.length > 0
          && object.manaValue <= x
        ) {
          draft.enqueue({ type: 'move', objectId: object.id, to: 'exile' })
        }
      }
      continue
    }
    if (instruction.kind === 'putPermanentsFromHand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'put-permanents',
        prompt: `You may put up to ${instruction.max} permanent cards from your hand onto the battlefield.`,
        waiting: 'is choosing permanent cards privately.',
        judge: 'Waiting for an optional permanent-card choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'battlefield'],
        permanent: true,
        optional: true,
        requirements: { battlefield: { max: instruction.max } },
      })
      continue
    }
    if (instruction.kind === 'putFromHand') {
      const living = draft.playerOrder.filter((seat) => !draft.players[seat].lost)
      const start = instruction.who === 'active'
        ? draft.active
        : source.controller
      const startIndex = Math.max(0, living.indexOf(start))
      const seats = instruction.who === 'each'
        ? [...living.slice(startIndex), ...living.slice(0, startIndex)]
        : [start]
      const types = instruction.types
      for (const seat of seats) {
        setPendingDialog(draft, {
          sourceId: source.id,
          source: source.name,
          seat,
          kind: 'put-permanents',
          prompt: types
            ? `You may put up to ${instruction.max} ${types.join(', ').toLowerCase()} card(s) from your hand onto the battlefield.`
            : `You may put up to ${instruction.max} permanent card(s) from your hand onto the battlefield.`,
          waiting: 'is choosing a card to put onto the battlefield.',
          judge: `Waiting for ${source.name} dump choices.`,
          chosenEvent: DIALOG_CHOSEN,
          destinations: ['hand', 'battlefield'],
          ...(types ? { types } : { permanent: true }),
          optional: instruction.optional !== false,
          sequence: draft.allocTs(),
          requirements: { battlefield: { max: instruction.max } },
        })
      }
      if (instruction.repeat) {
        draft.players[source.controller].data['dumpFromHand.repeat'] = {
          sourceId: source.id,
          source: source.name,
          types,
          max: instruction.max,
        }
      }
      continue
    }
    if (instruction.kind === 'secretCouncil') {
      draft.enqueue({
        type: 'custom',
        name: 'secretCouncil.begin',
        seat: source.controller,
        payload: { sourceId: source.id, source: source.name },
      })
      continue
    }
    if (instruction.kind === 'fightUpToOne') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'fight-target',
        prompt: `Choose up to one creature ${source.name} fights.`,
        waiting: 'is choosing a creature to fight.',
        judge: `Waiting for ${source.name} to pick a fight.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        sequence: draft.allocTs(),
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'fight') {
      const left = instruction.with === 'self-target'
        ? { kind: 'object' as const, objectId: source.id }
        : item?.targets[0]
      const right = instruction.with === 'self-target'
        ? item?.targets[0]
        : item?.targets[1]
      if (left?.kind === 'object' && right?.kind === 'object') {
        const first = draft.object(left.objectId)
        const second = draft.object(right.objectId)
        if (first && second) {
          draft.enqueue({
            type: 'dealDamage',
            sourceId: first.id,
            target: { kind: 'object', objectId: second.id },
            amount: first.power ?? 0,
          })
          draft.enqueue({
            type: 'dealDamage',
            sourceId: second.id,
            target: { kind: 'object', objectId: first.id },
            amount: second.power ?? 0,
          })
          draft.note(`${first.name} fights ${second.name}`)
        }
      }
      continue
    }
    if (instruction.kind === 'exchangeControlUntilEot') {
      const opponent = item?.targets.find((target) => target.kind === 'player')
      if (opponent?.kind === 'player') {
        const you = source.controller
        const them = opponent.player
        const swaps: Array<{ objectId: string; previous: string }> = []
        for (const object of Object.values(draft.objects)) {
          if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
          if (object.controller !== you && object.controller !== them) continue
          swaps.push({ objectId: object.id, previous: object.controller })
          object.controller = object.controller === you ? them : you
          object.tapped = false
          if (!/haste/i.test(object.oracleText)) {
            object.oracleText = object.oracleText ? `${object.oracleText}\nHaste` : 'Haste'
          }
        }
        draft.players[you].data['reinsOfPower.swaps'] = [
          ...((Array.isArray(draft.players[you].data['reinsOfPower.swaps'])
            ? draft.players[you].data['reinsOfPower.swaps']
            : []) as Array<{ objectId: string; previous: string }>),
          ...swaps,
        ]
        draft.note(`${you} exchanges creature control with ${them}`)
      }
      continue
    }
    if (instruction.kind === 'bounceAttacking') {
      for (const object of Object.values(draft.objects)) {
        if (object.zone === 'battlefield' && object.attacking) {
          draft.enqueue({ type: 'move', objectId: object.id, to: 'hand' })
        }
      }
      continue
    }
    if (instruction.kind === 'chooseVotesThisTurn') {
      draft.players[source.controller].data['secretCouncil.chooseVotes'] = true
      continue
    }
    if (instruction.kind === 'discardHandsThenDrawGreatest') {
      const count = Math.max(
        0,
        ...draft.playerOrder.map((seat) => draft.zoneOrder[seat].hand.length),
      )
      for (const seat of draft.playerOrder) {
        for (const objectId of draft.zoneOrder[seat].hand) {
          draft.enqueue({ type: 'discard', seat, objectId })
        }
        draft.enqueue({ type: 'draw', seat, count })
      }
      continue
    }
    if (instruction.kind === 'extraLandPlays') {
      draft.enqueue({
        type: 'custom',
        name: 'additionalLandPlay.grant',
        seat: source.controller,
        payload: { count: instruction.count },
      })
      continue
    }
    if (instruction.kind === 'returnOwnedGraveyardLands') {
      returnOwnedLands(draft, source.controller, instruction.tapped !== false)
      continue
    }
    if (instruction.kind === 'createToken') {
      createToken(draft, source.controller, {
        name: instruction.token.name,
        types: instruction.token.types,
        subtypes: instruction.token.subtypes ?? [],
        power: instruction.token.power ?? null,
        toughness: instruction.token.toughness ?? null,
        oracleText: instruction.token.oracleText ?? '',
      })
      continue
    }
    if (instruction.kind === 'copySelf') {
      const live = draft.object(source.id) ?? source
      createToken(draft, live.controller, {
        name: live.name,
        types: [...live.types],
        subtypes: [...live.subtypes],
        power: live.power,
        toughness: live.toughness,
        oracleText: live.oracleText,
        effects: live.effects ?? [],
      })
      continue
    }
    if (instruction.kind === 'doublePlusCounters') {
      const live = draft.object(source.id)
      if (!live) continue
      addPlusCounters(live, live.counters['+1/+1'] ?? 0)
      draft.note(`${live.name} doubles to ${live.counters['+1/+1'] ?? 0} +1/+1 counters`)
      continue
    }
    if (instruction.kind === 'surveil') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'surveil',
        prompt: `Surveil ${instruction.count}.`,
        waiting: 'is making a private surveil choice.',
        judge: 'Waiting for a private surveil choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['top', 'graveyard'],
        count: instruction.count,
      })
      continue
    }
    if (instruction.kind === 'putLandFromHand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'put-land',
        prompt: instruction.tapped
          ? 'You may put a land from your hand onto the battlefield tapped.'
          : 'You may put a land from your hand onto the battlefield.',
        waiting: 'is choosing a land privately.',
        judge: 'Waiting for an optional land.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'battlefield'],
        types: ['Land'],
        optional: true,
        requirements: { battlefield: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'bounceChosenLand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'bounce-land',
        prompt: 'Return a land you control to its owner’s hand.',
        waiting: 'is choosing a land to return.',
        judge: 'Waiting for a land to bounce.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['battlefield', 'hand'],
        types: ['Land'],
        requirements: { hand: { min: 1, max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'revealPick') {
      const ids = draft.zoneOrder[source.controller].library.slice(0, instruction.count)
      if (ids.length > 0) {
        draft.enqueue({ type: 'reveal', seat: source.controller, objectIds: ids, source: source.name })
      }
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'reveal-pick',
        prompt: instruction.type
          ? `You may put a ${instruction.type.toLowerCase()} card into your hand.`
          : 'You may put a matching card into your hand.',
        waiting: 'is choosing among revealed cards.',
        judge: 'Waiting for a revealed-card pick.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['hand', 'graveyard'],
        count: instruction.count,
        ...(instruction.type ? { types: [instruction.type] } : {}),
        ...(instruction.permanent ? { permanent: true } : {}),
        optional: true,
        requirements: { hand: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'copyControlledCreature') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'copy-creature',
        prompt: 'You may have this enter as a copy of a creature you control.',
        waiting: 'is choosing a creature to copy.',
        judge: 'Waiting for an optional clone.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'copyTargetCreature') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      const copied = draft.object(target.objectId)
      if (!copied) continue
      createToken(draft, source.controller, copyTemplate(copied, {
        notLegendary: instruction.notLegendary,
        flying: instruction.flying,
      }))
      continue
    }
    if (instruction.kind === 'returnTargetFromGraveyard') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      draft.enqueue({
        type: 'move',
        objectId: target.objectId,
        to: instruction.to,
        ...(instruction.to === 'battlefield' ? { controller: source.controller } : {}),
      })
      if (instruction.tapped && instruction.to === 'battlefield') {
        draft.enqueue({ type: 'tap', objectId: target.objectId })
      }
      continue
    }
    if (instruction.kind === 'pump') {
      const target = item?.targets[0]
      const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
      if (!object || object.power === null || object.toughness === null) continue
      object.power += instruction.power
      object.toughness += instruction.toughness
      continue
    }
    if (instruction.kind === 'grantUntilEot') {
      const target = item?.targets[0]
      const object = target?.kind === 'object' ? draft.object(target.objectId) : undefined
      if (!object) continue
      const extra = instruction.keywords.join(', ')
      object.oracleText = object.oracleText
        ? `${object.oracleText}\n${extra}`
        : extra
      continue
    }
    if (instruction.kind === 'createXTokens') {
      const count = Math.max(0, item?.x ?? 0)
      for (let index = 0; index < count; index += 1) {
        createToken(draft, source.controller, {
          name: instruction.token.name,
          types: instruction.token.types,
          subtypes: instruction.token.subtypes ?? [],
          power: instruction.token.power ?? null,
          toughness: instruction.token.toughness ?? null,
          oracleText: instruction.token.oracleText ?? '',
        })
      }
      continue
    }
    if (instruction.kind === 'dealDamageToSelf') {
      draft.enqueue({
        type: 'dealDamage',
        sourceId: source.id,
        target: { kind: 'player', player: source.controller },
        amount: instruction.amount,
      })
      continue
    }
    if (instruction.kind === 'addChosenColorMana') {
      continue
    }
    if (instruction.kind === 'putMilledLandTapped') {
      const objectId = typeof item?.payload?.triggeringObjectId === 'string'
        ? item.payload.triggeringObjectId
        : undefined
      if (!objectId) continue
      const land = draft.object(objectId)
      if (!land || !land.types.includes('Land')) continue
      draft.enqueue({ type: 'move', objectId, to: 'battlefield' })
      draft.enqueue({ type: 'tap', objectId })
      continue
    }
    if (instruction.kind === 'optionalMill') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'may',
        prompt: `You may mill ${instruction.count} cards.`,
        waiting: 'is deciding whether to mill.',
        judge: 'Waiting for an optional mill.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        count: instruction.count,
        optional: true,
      })
      continue
    }
    if (instruction.kind === 'mayDraw') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'may-draw',
        prompt: 'An opponent lost 3 or more life this turn. You may draw a card.',
        waiting: 'is deciding whether to draw.',
        judge: `Waiting for an optional draw from ${source.name}.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        count: instruction.count,
      })
      continue
    }
    if (instruction.kind === 'chooseModes') {
      openSourceDialog(draft, source, {
        seat: source.controller,
        kind: 'choose-modes',
        options: instruction.modes.map((mode) => mode.label),
        prompt: instruction.choose === 'any'
          ? `${source.name}: choose any number of modes.`
          : `Choose one — ${source.name}.`,
        waiting: 'is choosing modes.',
        judge: `Waiting for ${source.name} mode choice.`,
        destinations: ['skip', 'target'],
        ...(instruction.choose === 'one'
          ? { requirements: { target: { min: 1, max: 1 } } }
          : {}),
      })
      continue
    }
    if (instruction.kind === 'eachPlayerDiscard') {
      askEachPlayerChoice(draft, source, 'discard-card')
      continue
    }
    if (instruction.kind === 'eachPlayerSacrifice') {
      askEachPlayerChoice(draft, source, 'sacrifice-creature')
      continue
    }
    if (instruction.kind === 'eachPlayerLoseLife') {
      for (const seat of apnapSeats(draft)) {
        draft.enqueue({
          type: 'loseLife',
          seat,
          amount: instruction.amount,
          source: source.id,
        })
      }
      continue
    }
    if (instruction.kind === 'eachPlayerDraw') {
      for (const seat of apnapSeats(draft)) {
        draft.enqueue({ type: 'draw', seat, count: instruction.count })
      }
      continue
    }
    if (instruction.kind === 'returnChosenLandFromGraveyard') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'return-land',
        prompt: 'Return a land card from your graveyard to the battlefield tapped.',
        waiting: 'is choosing a land in the graveyard.',
        judge: 'Waiting for a graveyard land.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['graveyard', 'battlefield'],
        types: ['Land'],
        requirements: { battlefield: { min: 1, max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'drawAtNextUpkeep') {
      const seat = instruction.who === 'you'
        ? source.controller
        : item?.targets[0]?.kind === 'object'
          ? draft.object(item.targets[0].objectId)?.controller
          : item?.targets[0]?.kind === 'player'
            ? item.targets[0].player
            : undefined
      if (!seat) continue
      const player = draft.players[seat]
      const queued = Array.isArray(player.data.delayedDraw)
        ? [...player.data.delayedDraw as number[]]
        : []
      queued.push(instruction.optional ? -instruction.count : instruction.count)
      player.data.delayedDraw = queued
      continue
    }
    if (instruction.kind === 'copyAllCreaturesUntilEot') {
      const target = item?.targets[0]
      const copied = target?.kind === 'object' ? draft.object(target.objectId) : undefined
      if (!copied) continue
      for (const object of Object.values(draft.objects)) {
        if (object.zone !== 'battlefield' || !object.types.includes('Creature')) continue
        if (object.id === copied.id) continue
        applyCopy(object, copied, { notLegendary: instruction.notLegendary })
      }
      continue
    }
    if (instruction.kind === 'createTreasures') {
      const seat = instruction.who === 'you'
        ? source.controller
        : item?.targets[0]?.kind === 'object'
          ? draft.object(item.targets[0].objectId)?.controller
          : undefined
      if (!seat) continue
      for (let index = 0; index < instruction.count; index += 1) {
        createToken(draft, seat, {
          name: 'Treasure',
          types: ['Artifact'],
          subtypes: ['Treasure'],
          oracleText: '{T}, Sacrifice this token: Add one mana of any color.',
        })
      }
      continue
    }
    if (instruction.kind === 'drawGreatestPower') {
      const greatest = Math.max(0, ...Object.values(draft.objects)
        .filter((object) =>
          object.zone === 'battlefield'
          && object.controller === source.controller
          && object.types.includes('Creature')
          && (!instruction.nonHuman || !object.subtypes.includes('Human')))
        .map((object) => object.power ?? 0))
      if (greatest > 0) {
        draft.enqueue({ type: 'draw', seat: source.controller, count: greatest })
      }
      continue
    }
    if (instruction.kind === 'pumpControlled') {
      const bonus = instruction.powerFromGreatest
        ? Math.max(0, ...Object.values(draft.objects)
          .filter((object) =>
            object.zone === 'battlefield'
            && object.controller === source.controller
            && object.types.includes('Creature'))
          .map((object) => object.power ?? 0))
        : instruction.power
      const toughnessBonus = instruction.powerFromGreatest ? bonus : instruction.toughness
      for (const object of Object.values(draft.objects)) {
        if (object.zone !== 'battlefield' || object.controller !== source.controller) continue
        if (!object.types.includes('Creature')) continue
        if (instruction.other && object.id === source.id) continue
        if (instruction.nonHuman && object.subtypes.includes('Human')) continue
        if (object.power !== null) object.power += bonus
        if (object.toughness !== null) object.toughness += toughnessBonus
        if (instruction.trample && !object.oracleText.toLowerCase().includes('trample')) {
          object.oracleText = object.oracleText ? `${object.oracleText}\nTrample` : 'Trample'
        }
      }
      continue
    }
    if (instruction.kind === 'searchLibrary') {
      draft.enqueue({
        type: 'custom',
        name: 'librarySearch.begin',
        seat: source.controller,
        payload: {
          source: source.name,
          sourceId: source.id,
          via: 'resolve',
          spec: instruction.spec,
        },
      })
      continue
    }
    if (instruction.kind === 'fightOwnedVsOpponent') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'fight-own',
        prompt: 'Choose a creature you control to fight.',
        waiting: 'is choosing a creature to fight with.',
        judge: `Waiting for ${source.name} fight targets.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: ['Creature'],
        optional: true,
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'counterUnlessPay') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'counter-unless',
        prompt: `Counter target noncreature spell unless its controller pays {${instruction.amount}}.`,
        waiting: 'is choosing a spell to counter.',
        judge: `Waiting for ${source.name} to pick a stack target.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        requirements: { target: { max: 1 } },
      })
      draft.players[source.controller].data['counterUnlessPay.amount'] = instruction.amount
      continue
    }
    if (instruction.kind === 'copyTargetSpell') {
      const target = item?.targets[0]
      if (target?.kind !== 'object') continue
      const copied = draft.object(target.objectId)
      const stackItem = draft.stack.find((candidate) => candidate.objectId === target.objectId)
      if (!copied || !stackItem || copied.zone !== 'stack') continue
      draft.stack.unshift({
        id: draft.allocId('s'),
        kind: 'spell',
        objectId: copied.id,
        controller: source.controller,
        name: copied.name,
        targets: [...stackItem.targets],
        ...(stackItem.kicked ? { kicked: true } : {}),
        ...(stackItem.x !== undefined ? { x: stackItem.x } : {}),
        ...(stackItem.choices ? { choices: [...stackItem.choices] } : {}),
      })
      draft.note(`${source.name} copies ${copied.name}`)
      continue
    }
    if (instruction.kind === 'destroyTargetPermanent') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'destroy-permanent',
        prompt: `Destroy target ${instruction.types.join(' or ').toLowerCase()}.`,
        waiting: 'is choosing a permanent to destroy.',
        judge: `Waiting for ${source.name} to pick a target.`,
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['skip', 'target'],
        types: instruction.types,
        optional: true,
        requirements: { target: { max: 1 } },
      })
      continue
    }
    if (instruction.kind === 'grantControlled') {
      const extra = instruction.keywords.join(', ')
      for (const object of Object.values(draft.objects)) {
        if (object.zone !== 'battlefield' || object.controller !== source.controller) continue
        if (!object.types.includes('Creature')) continue
        if (instruction.other && object.id === source.id) continue
        if (instruction.nonHuman && object.subtypes.includes('Human')) continue
        object.oracleText = object.oracleText ? `${object.oracleText}\n${extra}` : extra
      }
      continue
    }
    if (instruction.kind === 'lookTopPutLand') {
      setPendingDialog(draft, {
        sourceId: source.id,
        source: source.name,
        seat: source.controller,
        kind: 'look-top-land',
        prompt: `Look at the top ${instruction.count} cards. You may put a land onto the battlefield tapped.`,
        waiting: 'is choosing among the top cards.',
        judge: 'Waiting for a look-top land choice.',
        chosenEvent: DIALOG_CHOSEN,
        destinations: ['bottom', 'battlefield'],
        count: instruction.count,
        types: ['Land'],
        optional: true,
        requirements: { battlefield: { max: 1 } },
      })
      continue
    }
  }

  if (buffer && stackBuffer === undefined) flushStackActions(draft, source, buffer, item)
}
