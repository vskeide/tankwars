import type { PlayerSetup, TurnBasedMatch } from '../core/rules/turnBased';
import type { GameModeId } from '../core/types';

/** What the menu hands to the battle scene. */
export interface BattleSetup {
  kind: 'turn' | 'arena' | 'campaign';
  /** Campaign level id when kind === 'campaign'. */
  levelId?: string;
  commanderId?: string;
  difficultyId?: string;
  mode: GameModeId;
  players: PlayerSetup[];
  rounds: number;
  terrainStyle: string;
  /** Turn-based only: 'drop' = players choose where their tank lands each round. */
  placement?: 'drop' | 'random';
  /**
   * A match restored from a save game, handed straight to the battle scene
   * instead of building a new one from this setup.
   */
  resume?: TurnBasedMatch;
  seed: number;
}

export const DEFAULT_SETUP: BattleSetup = {
  kind: 'turn',
  mode: 'classic',
  players: [
    { name: 'Player 1', colour: 0, isBot: false, difficulty: 'gunner', tankClass: 'line' },
    { name: 'Bot Kilo', colour: 1, isBot: true, difficulty: 'gunner', tankClass: 'bulwark' },
  ],
  rounds: 3,
  terrainStyle: 'random',
  placement: 'drop',
  seed: Date.now() & 0x7fffffff,
};
