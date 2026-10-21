import { expect, test } from 'bun:test'
import { TOKEN_CATALOG, token } from './index'

test('token() resolves distinctive catalog ids', () => {
  expect(token('Inkling-2-1-WB-flying')).toMatchObject({
    name: 'Inkling', power: 2, toughness: 1, colors: ['W', 'B'], oracleText: 'Flying',
  })
  expect(token('Treasure')).toMatchObject({
    name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'],
    oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
  })
  expect(token('Eldrazi-Spawn-0-1').abilities).toHaveLength(1)
})

test('every catalog key is unique and returns its printed name', () => {
  const ids = Object.keys(TOKEN_CATALOG)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) {
    expect(token(id as keyof typeof TOKEN_CATALOG).name.length).toBeGreaterThan(0)
  }
})
