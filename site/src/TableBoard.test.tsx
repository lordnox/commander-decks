import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CardTile, StackOverlay } from './TableBoard'
import type { ReplayGame } from './replayTypes'

const game = {
  seats: [{
    id: 'p1',
    name: 'Eva',
    color: '#ffffff',
  }],
  catalog: {
    'Mossborn Hydra': {
      type_line: 'Creature — Elemental Hydra',
      stats: '0/0',
    },
    'Teferi, Who Slows the Sunset': {
      id: '12345678-1234-1234-1234-123456789abc',
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

test('a loyalty activation previews its source card and uses a readable label', () => {
  const html = renderToStaticMarkup(
    <StackOverlay
      game={game}
      stack={[{
        name: 'Teferi, Who Slows the Sunset',
        kind: 'ability',
        controller: 'p1',
        text: '+1 loyalty activation',
      }]}
      onPreview={() => {}}
      onHover={() => {}}
    />,
  )

  expect(html).toContain('Teferi, Who Slows the Sunset')
  expect(html).toContain('+1 loyalty activation')
  expect(html).not.toContain('teferi.plus-one')
})
