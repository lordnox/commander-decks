import { resolveName } from './cards'
import type { ReplayEvent, ReplayGame } from './replayTypes'

const seatLabel = (game: ReplayGame, value: string | number) => {
  const name = resolveName(game, value)
  return game.seats.find((seat) => seat.id === name)?.name ?? name
}

export const combatLines = (game: ReplayGame, event: ReplayEvent) => {
  const combat = event.combat
  const lines: string[] = []

  for (const attacker of combat?.attackers ?? []) {
    const traits = [
      attacker.pt,
      attacker.keywords?.join(', '),
      attacker.tapped === false ? 'stays untapped' : '',
    ].filter(Boolean)
    const detail = traits.length > 0 ? ` (${traits.join(', ')})` : ''
    lines.push(
      `Attacks ${seatLabel(game, attacker.defender)}: ${resolveName(game, attacker.card)}${detail}`,
    )
  }

  for (const [seat, blockers] of Object.entries(combat?.possible_blockers ?? {})) {
    const list = blockers.map((blocker) => resolveName(game, blocker)).join(', ')
    lines.push(`${seatLabel(game, seat)} could block with ${list || 'nothing'}`)
  }

  for (const block of combat?.blocks ?? []) {
    const blockers = block.blockers.map((blocker) => resolveName(game, blocker))
    lines.push(`Blocks ${resolveName(game, block.attacker)} with ${blockers.join(' + ')}`)
  }
  if (combat?.blocks && combat.blocks.length === 0) lines.push('Declares no blockers')

  for (const attacker of combat?.unblocked ?? []) {
    lines.push(`${resolveName(game, attacker)} is unblocked`)
  }

  for (const hit of event.damage ?? []) {
    const extra = [hit.commander ? 'commander damage' : '', hit.keyword]
      .filter(Boolean)
      .join(', ')
    const kind = hit.type === 'combat' ? 'combat damage' : 'damage'
    lines.push(
      `${resolveName(game, hit.source)} deals ${hit.amount} ${kind} to ` +
        `${seatLabel(game, hit.target)}${extra ? ` (${extra})` : ''}`,
    )
  }

  return lines
}
