/**
 * Headless smoke test for the pure core: bots fight through a turn-based match
 * and an arena match with no renderer. Fails loudly on NaN, stuck phases or
 * rounds that never end.
 *
 *    npx tsx tools/smoke.ts
 */
import { TurnBasedMatch } from '../src/core/rules/turnBased';
import { ArenaMatch } from '../src/core/rules/arena';
import { CampaignLevel } from '../src/core/rules/campaign';
import { BotController } from '../src/core/ai';
import { SIM_DT } from '../src/core/physics';
import { emptyIntent } from '../src/core/input';
import type { GameModeId } from '../src/core/types';

const W = 960;
const H = 510;

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

function turnBased(mode: GameModeId, seed: number): void {
  const players = [
    { name: 'A', colour: 0, isBot: true, difficulty: 'deadeye' as const, tankClass: 'line' },
    { name: 'B', colour: 1, isBot: true, difficulty: 'veteran' as const, tankClass: 'bulwark' },
    { name: 'C', colour: 2, isBot: true, difficulty: 'gunner' as const, tankClass: 'battery' },
  ];
  const m = new TurnBasedMatch({ mode, players, rounds: 2, seed, width: W, height: H, terrainStyle: 'random' });
  const bots = new Map(m.world.tanks.map((t) => [t.index, new BotController()]));
  let lastKey = '';
  let steps = 0;
  let shots = 0;
  const maxSteps = 120 * 60 * 20; // 20 sim minutes
  while (m.phase !== 'matchOver' && steps < maxSteps) {
    if (m.phase === 'shop') {
      m.finishShop();
      continue;
    }
    if (m.phase === 'roundOver') {
      m.proceedFromRoundOver();
      continue;
    }
    let intent = emptyIntent();
    if (m.phase === 'aim') {
      const t = m.currentTank;
      const key = `${m.round}:${m.turn}:${m.current}:${m.shotsLeftThisTurn}`;
      if (key !== lastKey) {
        lastKey = key;
        bots.get(t.index)!.newTurn();
      }
      intent = bots.get(t.index)!.turnIntent(m.world, t, SIM_DT);
      if (intent.fire) shots++;
    }
    m.update(intent, SIM_DT);
    for (const t of m.world.tanks) check(Number.isFinite(t.x) && Number.isFinite(t.y), `NaN tank position in ${mode}`);
    steps++;
  }
  check(m.phase === 'matchOver', `${mode}: match did not finish (phase ${m.phase}, round ${m.round}, steps ${steps})`);
  const w = m.world.tanks[m.matchWinner];
  console.log(`turn/${mode.padEnd(8)} seed ${seed}: winner ${w.name} · ${shots} shots · ${(steps / 120).toFixed(0)} sim-s · kills ${m.world.tanks.map((t) => t.kills).join('/')}`);
}

function arena(seed: number): void {
  const players = [
    { name: 'A', colour: 0, isBot: true, difficulty: 'deadeye' as const, tankClass: 'scout' },
    { name: 'B', colour: 1, isBot: true, difficulty: 'veteran' as const, tankClass: 'aegis' },
    { name: 'C', colour: 2, isBot: true, difficulty: 'veteran' as const, tankClass: 'strider' },
  ];
  const m = new ArenaMatch({ players, rounds: 2, seed, width: W, height: H, terrainStyle: 'random', crateInterval: 6, windInterval: 10 });
  const bots = m.world.tanks.map(() => new BotController());
  let steps = 0;
  let crates = 0;
  let pickups = 0;
  const maxSteps = 120 * 60 * 10;
  while (m.phase !== 'matchOver' && steps < maxSteps) {
    if (m.phase === 'roundOver') {
      m.proceedFromRoundOver();
      continue;
    }
    const intents = m.world.tanks.map((t, i) => bots[i].arenaIntent(m.world, t, SIM_DT));
    m.update(intents, SIM_DT);
    for (const e of m.world.drainEvents()) {
      if (e.kind === 'crateSpawn') crates++;
      if (e.kind === 'cratePickup') pickups++;
    }
    steps++;
  }
  check(m.phase === 'matchOver', `arena: match did not finish (phase ${m.phase}, round ${m.round})`);
  const w = m.world.tanks[m.matchWinner];
  console.log(`arena          seed ${seed}: winner ${w.name} · ${(steps / 120).toFixed(0)} sim-s · crates ${crates} picked ${pickups} · kills ${m.world.tanks.map((t) => t.kills).join('/')}`);
}

function campaign(levelId: string, seed: number): void {
  const players = [{ name: 'Hero', colour: 0, isBot: true, difficulty: 'deadeye' as const, tankClass: 'line' }];
  const c = new CampaignLevel({ levelId, players, seed, width: W, height: H });
  const bots = c.world.tanks.map(() => new BotController());
  let steps = 0;
  const maxSteps = 120 * 60 * 6;
  while (c.phase !== 'won' && c.phase !== 'lost' && steps < maxSteps) {
    const intents = c.world.tanks.map((t, i) => bots[i].arenaIntent(c.world, t, SIM_DT));
    c.update(intents, SIM_DT);
    c.world.drainEvents();
    for (const t of c.world.tanks) check(Number.isFinite(t.x) && Number.isFinite(t.y), 'NaN in campaign');
    steps++;
  }
  check(c.phase === 'won' || c.phase === 'lost', `campaign ${levelId}: did not resolve (phase ${c.phase})`);
  const bossHp = c.bosses.map((b) => [...b.hardpoints.values()].map((h) => `${h.hp}`).join(',')).join(' | ');
  console.log(`campaign ${levelId.padEnd(4)} seed ${seed}: ${c.phase} in ${(steps / 120).toFixed(0)} sim-s · hero hp ${c.world.tanks[0].hp}${bossHp ? ' · boss hp ' + bossHp : ''}`);
}

const t0 = Date.now();
for (const seed of [1, 2, 3]) {
  turnBased('classic', seed);
  turnBased('modern', seed);
  turnBased('advanced', seed);
  arena(seed);
}
campaign('l01', 1);
campaign('l03', 2);
campaign('b01', 3);
campaign('b02', 4);
console.log(`ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
