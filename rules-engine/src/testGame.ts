import { commanderRules } from './formats'
import {
  bears,
  bolt,
  forest,
  newGame as createGame,
  timetwister,
  yarokFixture,
  type NewGameOptions,
} from './newGame'

export const newGame = (options?: NewGameOptions) => createGame(commanderRules, options)

export { bears, bolt, forest, timetwister, yarokFixture }
