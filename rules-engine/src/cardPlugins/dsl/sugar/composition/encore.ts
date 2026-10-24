import { activated, choice, copy, createDelayed, createEffect, exileSourceCost, forEachPlayer, manaCost, objects, players, ref, sacrifice, stepDelayed, untilCleanup } from '../../builders'
import { KEYWORDS } from '../../schema/v1'

/** CR 702.141: shared graveyard payment, copies, attack requirements, and one delayed sacrifice. */
export const encore = (cost: string) => activated({
  availableFrom: ['graveyard'], timing: 'sorcery', costs: [manaCost(cost), exileSourceCost('graveyard')],
  instructions: [
    forEachPlayer({ of: players({ relation: 'opponent' }), collectObjects: { from: 'encoreCopy', as: 'encoreCopies' }, instructions: [
      copy({ targets: ref('source'), information: 'currentOrLastKnown', bindChoice: 'encoreCopy' }),
      createEffect({ targets: choice('encoreCopy'), effect: { kind: 'grantKeyword', keyword: KEYWORDS.haste }, duration: { kind: 'permanent' } }),
      createEffect({ targets: choice('encoreCopy'), effect: { kind: 'mustAttackPlayer', player: ref('event.player') }, duration: untilCleanup() }),
    ] }),
    createDelayed({ condition: stepDelayed({ step: 'end' }), inheritTargets: false,
      instructions: [sacrifice({ targets: objects({ among: choice('encoreCopies'), zone: 'battlefield', controller: 'you' }) })],
    }),
  ],
})
