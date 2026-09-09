/**
 * Save and restore an in-progress turn-based match.
 *
 * The core is plain data, so a save is just a JSON snapshot: the match config,
 * the per-tank state, and the terrain. The terrain is the only bulky part —
 * 1920 x 1036 material bytes — so it is run-length encoded column by column,
 * which suits it: a column is a handful of long runs (sky, then dirt bands),
 * and the whole map compresses to something localStorage will happily hold.
 *
 * Only the 'aim' phase is saveable, which is what makes this simple: nothing is
 * in flight, so projectiles never need serialising.
 */
import { Terrain } from './terrain';
import { TERRAIN_STYLES } from './terrain';
import { TurnBasedMatch, type TurnBasedConfig, type MatchStats } from './rules/turnBased';
import type { Tank } from './world';

/** Bumped whenever the shape below changes, so stale saves are refused not misread. */
export const SAVE_VERSION = 1;

interface SavedTank {
  index: number;
  x: number;
  y: number;
  tilt: number;
  facing: 1 | -1;
  hp: number;
  maxHp: number;
  reinforcedHp: number;
  shield: number;
  angle: number;
  power: number;
  fuel: number;
  alive: boolean;
  placed: boolean;
  credits: number;
  ammo: [string, number][];
  selectedWeapon: string;
  kills: number;
  roundsWon: number;
  movedThisTurn: boolean;
}

export interface SavedMatch {
  version: number;
  savedAt: number;
  config: TurnBasedConfig;
  /** Terrain style actually in play this round (config may say 'random'). */
  terrainStyleId: string;
  terrainWidth: number;
  terrainHeight: number;
  /** Run-length encoded materials: [material, runLength, material, runLength, ...]. */
  terrainRle: number[];
  wind: number;
  time: number;
  tanks: SavedTank[];
  round: number;
  turn: number;
  current: number;
  shotsLeftThisTurn: number;
  lastRoundWinner: number;
  order: number[];
  rngState: number;
  stats: [number, MatchStats][];
}

function encodeRle(mat: Uint8Array): number[] {
  const out: number[] = [];
  let run = 0;
  let prev = mat[0] ?? 0;
  for (let i = 0; i < mat.length; i++) {
    const m = mat[i];
    if (m === prev && run < 0xffffff) {
      run++;
      continue;
    }
    out.push(prev, run);
    prev = m;
    run = 1;
  }
  out.push(prev, run);
  return out;
}

function decodeRle(rle: number[], length: number): Uint8Array {
  const mat = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const m = rle[i];
    const run = rle[i + 1];
    if (m !== 0) mat.fill(m, at, Math.min(length, at + run));
    at += run;
  }
  return mat;
}

function saveTank(t: Tank): SavedTank {
  return {
    index: t.index,
    x: t.x,
    y: t.y,
    tilt: t.tilt,
    facing: t.facing,
    hp: t.hp,
    maxHp: t.maxHp,
    reinforcedHp: t.reinforcedHp,
    shield: t.shield,
    angle: t.angle,
    power: t.power,
    fuel: t.fuel,
    alive: t.alive,
    placed: t.placed,
    credits: t.credits,
    ammo: [...t.ammo.entries()],
    selectedWeapon: t.selectedWeapon,
    kills: t.kills,
    roundsWon: t.roundsWon,
    movedThisTurn: t.movedThisTurn,
  };
}

/** Snapshot a match. Returns null unless it is safe to save right now. */
export function serialiseMatch(m: TurnBasedMatch): SavedMatch | null {
  if (m.phase !== 'aim' || m.world.projectiles.length > 0) return null;
  const st = m.snapshotState();
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    config: m.config,
    terrainStyleId: m.world.terrain.style.id,
    terrainWidth: m.world.terrain.width,
    terrainHeight: m.world.terrain.height,
    terrainRle: encodeRle(m.world.terrain.mat),
    wind: m.world.wind,
    time: m.world.time,
    tanks: m.world.tanks.map(saveTank),
    round: st.round,
    turn: st.turn,
    current: st.current,
    shotsLeftThisTurn: st.shotsLeftThisTurn,
    lastRoundWinner: st.lastRoundWinner,
    order: st.order,
    rngState: st.rngState,
    stats: st.stats,
  };
}

/**
 * Rebuild a match from a snapshot. The constructor generates a fresh round from
 * the seed; every part of that is then overwritten with the saved state, the
 * terrain included, so the restored match is the one that was saved rather than
 * a replay of it.
 */
export function restoreMatch(s: SavedMatch): TurnBasedMatch {
  if (s.version !== SAVE_VERSION) throw new Error(`Save version ${s.version} is not supported`);
  const m = new TurnBasedMatch(s.config);

  const style = TERRAIN_STYLES.find((x) => x.id === s.terrainStyleId) ?? TERRAIN_STYLES[0];
  const terrain = new Terrain(s.terrainWidth, s.terrainHeight, style);
  terrain.mat.set(decodeRle(s.terrainRle, s.terrainWidth * s.terrainHeight));
  m.world.setTerrain(terrain);
  terrain.markDirty(0, 0, terrain.width - 1, terrain.height - 1);
  m.world.wind = s.wind;
  m.world.time = s.time;

  for (const saved of s.tanks) {
    const t = m.world.tanks[saved.index];
    if (!t) continue;
    t.x = saved.x;
    t.y = saved.y;
    t.tilt = saved.tilt;
    t.facing = saved.facing;
    t.hp = saved.hp;
    t.maxHp = saved.maxHp;
    t.reinforcedHp = saved.reinforcedHp;
    t.shield = saved.shield;
    t.angle = saved.angle;
    t.power = saved.power;
    t.fuel = saved.fuel;
    t.alive = saved.alive;
    t.placed = saved.placed;
    t.credits = saved.credits;
    t.ammo = new Map(saved.ammo);
    t.selectedWeapon = saved.selectedWeapon;
    t.kills = saved.kills;
    t.roundsWon = saved.roundsWon;
    t.movedThisTurn = saved.movedThisTurn;
    t.airborne = false;
    t.vy = 0;
    t.cooldown = 0;
  }

  m.restoreState({
    round: s.round,
    turn: s.turn,
    current: s.current,
    shotsLeftThisTurn: s.shotsLeftThisTurn,
    lastRoundWinner: s.lastRoundWinner,
    order: s.order,
    rngState: s.rngState,
    stats: s.stats,
  });
  return m;
}
