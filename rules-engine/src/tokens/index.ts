import { fish11U } from './fish'
import { zombie22B } from './zombie'
import type { TokenDefinition } from '../cardPlugins/dsl/schema/v1'
import { beast33G } from './beast'
import { bird22UFlying } from './bird'
import { eldraziSpawn01 } from './eldrazi-spawn'
import { elephant33G } from './elephant'
import { forestDryad11G } from './forest-dryad'
import { hero11 } from './hero'
import { inkling21WbFlying } from './inkling'
import { insect11G } from './insect'
import { treasure } from './treasure'

const catalog = {
  'Fish-1-1-U': fish11U,
  'Hero-1-1': hero11,
  'Zombie-2-2-B': zombie22B,
  'Beast-3-3-G': beast33G,
  'Bird-2-2-U-flying': bird22UFlying,
  'Eldrazi-Spawn-0-1': eldraziSpawn01,
  'Elephant-3-3-G': elephant33G,
  'Forest-Dryad-1-1-G': forestDryad11G,
  'Inkling-2-1-WB-flying': inkling21WbFlying,
  'Insect-1-1-G': insect11G,
  Treasure: treasure,
}

export type TokenId = keyof typeof catalog

export const TOKEN_CATALOG: Readonly<Record<TokenId, TokenDefinition>> = Object.freeze(catalog)

export const token = (id: TokenId) => TOKEN_CATALOG[id]
