import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CardTile } from './TableBoard'
import type { ReplayGame } from './replayTypes'

const game = {
  catalog: {
    'Mossborn Hydra': {
      type_line: 'Creature — Elemental Hydra',
      stats: '0/0',
    },
    'Teferi, Who Slows the Sunset': {
      type_line: 'Legendary Planeswalker — Teferi',
      stats: '4',
    },
  },
} as unknown as ReplayGame

test('a summoning-sick card shows a status icon', () => {
  const html = renderToStaticMarkup(
    <CardTile
      game={game}
      value="Mossborn Hydra"
      entry={{ name: 'Mossborn Hydra', summoningSickness: true }}
      onPreview={() => {}}
      onHover={() => {}}
    />,
  )

  expect(html).toContain('aria-label="Summoning sickness"')
})

test('loyalty is shown as a stat rather than a duplicate counter badge', () => {
  const html = renderToStaticMarkup(
    <CardTile
      game={game}
      value="Teferi, Who Slows the Sunset"
      entry={{
        name: 'Teferi, Who Slows the Sunset',
        counters: { loyalty: 5 },
      }}
      onPreview={() => {}}
      onHover={() => {}}
    />,
  )

  expect(html).toContain('L 5')
  expect(html).not.toContain('5 loyalty')
})
