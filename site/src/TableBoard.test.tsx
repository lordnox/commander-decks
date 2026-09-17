import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CardPreview,
  CardRow,
  CardTile,
  HoverCard,
  StackOverlay,
  type Hover,
} from './TableBoard'
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
    'Lady Evangela': {
      id: 'ab111111-1111-1111-1111-111111111111',
      type_line: 'Legendary Creature — Human Cleric',
      stats: '1/2',
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

test('an eligible attacker is highlighted and exposes its selection state', () => {
  const html = renderToStaticMarkup(
    <CardTile
      game={game}
      value="Mossborn Hydra"
      entry={{ name: 'Mossborn Hydra', objectId: 'hydra' }}
      interaction={{
        selectable: new Set(['hydra']),
        selected: new Set(['hydra']),
        label: 'Select attacker',
        onSelect: () => {},
      }}
      onPreview={() => {}}
      onHover={() => {}}
    />,
  )

  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('aria-label="Select attacker: Mossborn Hydra"')
  expect(html).toContain('border-orange-300')
})

test('a chosen attacker shows its targets as art beside that card', () => {
  const html = renderToStaticMarkup(
    <CardRow
      game={game}
      cards={[{ name: 'Mossborn Hydra', objectId: 'hydra' }]}
      action={new Set()}
      interaction={{
        selectable: new Set(['hydra']),
        selected: new Set(['hydra']),
        label: 'Select attacker',
        onSelect: () => {},
        choosingFor: 'hydra',
        targetLabel: 'Attack',
        targets: [
          { id: 'p1', name: 'Foggy Blood Transfusion', cardName: 'Lady Evangela' },
          { id: 'walker', name: 'Teferi, Who Slows the Sunset' },
        ],
        onChooseTarget: () => {},
      }}
      onPreview={() => {}}
      onHover={() => {}}
    />,
  )

  expect(html).toContain('aria-label="Attack: Foggy Blood Transfusion"')
  expect(html).toContain('aria-label="Attack: Teferi, Who Slows the Sunset"')
  expect(html).toContain('rounded-full')
  // The seat is recognized by its commander, not by the deck name.
  expect(html).toContain('cards.scryfall.io/small/front/a/b/ab111111-1111-1111-1111-111111111111.jpg')
})

test('an unchosen attacker shows no target art', () => {
  const html = renderToStaticMarkup(
    <CardRow
      game={game}
      cards={[{ name: 'Mossborn Hydra', objectId: 'hydra' }]}
      action={new Set()}
      interaction={{
        selectable: new Set(['hydra']),
        selected: new Set(),
        label: 'Select attacker',
        onSelect: () => {},
        choosingFor: null,
        targetLabel: 'Attack',
        targets: [{ id: 'p1', name: 'Eva', cardName: 'Lady Evangela' }],
        onChooseTarget: () => {},
      }}
      onPreview={() => {}}
      onHover={() => {}}
    />,
  )

  expect(html).not.toContain('aria-label="Attack: Eva"')
})

test('hovering a clone shows the copied face beside the card it is printed as', () => {
  const hover: Hover = {
    name: 'Sygg, River Cutthroat',
    details: { image_normal: 'https://cards.example/sygg.jpg' },
    printed: {
      name: 'Spark Double',
      details: { image_normal: 'https://cards.example/spark.jpg' },
    },
    anchor: { top: 100, bottom: 200, left: 100, right: 200 },
  }

  // The overlay places itself against the viewport, which server rendering lacks.
  globalThis.window = { innerWidth: 1440, innerHeight: 900 } as Window & typeof globalThis
  const html = renderToStaticMarkup(<HoverCard hover={hover} />)

  expect(html).toContain('https://cards.example/sygg.jpg')
  expect(html).toContain('https://cards.example/spark.jpg')
  expect(html).toContain('Copying')
  expect(html).toContain('Actually')
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

test('a card preview lists its host-advertised actions', () => {
  const html = renderToStaticMarkup(
    <CardPreview
      preview={{
        name: 'Mossborn Hydra',
        details: game.catalog['Mossborn Hydra'],
        objectId: 'o7',
      }}
      acts={[
        { kind: 'playLand', objectId: 'o7', name: 'Mossborn Hydra' },
        { kind: 'tapForMana', objectId: 'o7', name: 'Mossborn Hydra', mana: 'G' },
      ]}
      onAct={() => {}}
      onClose={() => {}}
    />,
  )

  expect(html).toContain('Play land')
  expect(html).toContain('Tap for {G}')
})

test('a targeted fast cast asks for its target after Cast', () => {
  const html = renderToStaticMarkup(
    <CardPreview
      preview={{
        name: 'Reanimate',
        details: game.catalog['Mossborn Hydra'],
        objectId: 'spell',
      }}
      acts={[{
        kind: 'castSpell',
        objectId: 'spell',
        name: 'Reanimate',
        targetObjectId: 'creature',
        targetName: 'Mossborn Hydra',
      }]}
      onAct={() => {}}
      onClose={() => {}}
    />,
  )

  expect(html).toContain('>Cast<')
  expect(html).not.toContain('Choose target')
})
