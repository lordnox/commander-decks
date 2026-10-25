import { commanderRules } from './formats'
import {
  bears,
  bolt,
  forest,
  newGame as createGame,
  planeswalker,
  yarokFixture,
  yurlokFixture,
  type NewGameOptions,
} from './newGame'

export const newGame = (options?: NewGameOptions) => createGame(commanderRules, options)

export { bears, bolt, forest, planeswalker, yarokFixture, yurlokFixture }
