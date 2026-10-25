import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { freezeDraft, makeDraft } from '../src/draft'
import { commanderRules } from '../src/formats'
import { cardTemplate } from '../src/newGame'
import { createServerGame } from '../src/runtime'
import { openCardSelection, pendingSelectionFor } from '../src/rules/selectCards'
import { openPlayerSelection } from '../src/rules/selectPlayers'
import type { GameEvent } from '../src/types'

const repositoryRoot = resolve(import.meta.dir, '../..')
const outputDirectory = resolve(repositoryRoot, 'rules-engine/migration/compatibility-fixtures')
const outputPath = resolve(outputDirectory, 'rules-engine-v0.json')

const card = (name: string, types: string[] = ['Instant']) => cardTemplate(name, { types })

const openCardChoice = () => {
  const server = createServerGame(commanderRules, {
    hands: { p1: [card('Fixture Alpha'), card('Fixture Beta')] },
    players: 2,
  }, { random: () => 0.5 })
  const [alpha, beta] = server.state.zoneOrder.p1.hand
  const draft = makeDraft(server.state)
  openCardSelection(draft, {
    seat: 'p1',
    kind: 'discard',
    count: 1,
    candidates: [alpha, beta],
    source: 'Part 00 card choice',
    destinations: ['graveyard'],
  })
  const state = freezeDraft(draft)
  const selection = pendingSelectionFor(state, 'p1')
  if (!selection) throw new Error('card-choice fixture did not open')
  const answer: GameEvent = {
    type: 'selectCards',
    seat: 'p1',
    kind: 'discard',
    count: 1,
    objectIds: [beta],
  }
  return {
    state,
    pendingId: selection.id,
    answer,
    expected: { movedObjectId: beta, destination: 'graveyard' },
  }
}

const openPlayerChoice = () => {
  const server = createServerGame(commanderRules, {
    battlefield: { p1: [cardTemplate('Part 00 source', { types: ['Creature'] })] },
    players: 2,
  }, { random: () => 0.5 })
  const draft = makeDraft(server.state)
  draft.players.p1.life = 31
  draft.players.p2.life = 17
  const sourceId = draft.zoneOrder.p1.battlefield[0]
  const selection = openPlayerSelection(draft, {
    seat: 'p1',
    sourceId,
    source: 'Part 00 player choice',
    prompt: 'Choose another player.',
    min: 1,
    max: 1,
    candidates: ['p2'],
    action: { kind: 'exchangeLifeTotals' },
  })
  const state = freezeDraft(draft)
  const answer: GameEvent = {
    type: 'selectPlayers',
    selectionId: selection.id,
    seat: 'p1',
    players: ['p2'],
  }
  return {
    state,
    pendingId: selection.id,
    answer,
    expected: { p1Life: 17, p2Life: 31 },
  }
}

const cardChoice = openCardChoice()
const playerChoice = openPlayerChoice()

const fixture = {
  schema: 'rule-dsl-compatibility-fixtures/v1',
  engineSchema: 'rules-engine/v0',
  generatedFrom: '20f6da632c26633aae5eb660fa28d81c3c125f78',
  commands: {
    openCardChoiceAnswer: cardChoice.answer,
    openPlayerChoiceAnswer: playerChoice.answer,
  },
  savedStates: {
    openCardChoice: cardChoice,
    openPlayerChoice: playerChoice,
  },
}

mkdirSync(outputDirectory, { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`Wrote ${outputPath.replace(`${repositoryRoot}/`, '')}`)
