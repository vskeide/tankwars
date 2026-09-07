/**
 * Bot brains. A bot never touches the world directly: it emits an Intent each
 * frame like any other controller, steering its barrel toward a solution it
 * found by running the real ballistics forward on the real terrain.
 */
import type { World, Tank, Damageable } from './world';
import { launchVelocity, simulateFlight, type TankHitbox } from './physics';
import { weaponById, type Weapon } from './weapons';
import { emptyIntent, type Intent } from './input';
import type { Difficulty } from './types';

interface Profile {
  samples: number;
  refine: number;
  angleNoise: number;
  powerNoise: number;
  lazy: number;
  usesSpecials: boolean;
  shops: boolean;
  /** Arena: seconds between re-solving. */
  rethink: number;
  /** Arena: how eagerly it chases crates (0..1). */
  greed: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  rookie: { samples: 60, refine: 0, angleNoise: 7, powerNoise: 9, lazy: 0.4, usesSpecials: false, shops: false, rethink: 2.5, greed: 0.2 },
  gunner: { samples: 140, refine: 1, angleNoise: 3.5, powerNoise: 4.5, lazy: 0.2, usesSpecials: true, shops: true, rethink: 1.8, greed: 0.4 },
  veteran: { samples: 260, refine: 2, angleNoise: 1.6, powerNoise: 2, lazy: 0.05, usesSpecials: true, shops: true, rethink: 1.2, greed: 0.6 },
  deadeye: { samples: 400, refine: 3, angleNoise: 0.5, powerNoise: 0.6, lazy: 0, usesSpecials: true, shops: true, rethink: 0.8, greed: 0.7 },
};

export interface Solution {
  angle: number;
  power: number;
  weaponId: string;
  targetId: number;
  miss: number;
}

// ---------------------------------------------------------------------------

export class BotController {
  private solution: Solution | null = null;
  private rethinkTimer = 0;
  private wanderDir = 0;
  private wanderTimer = 0;
  private fired = false;

  constructor(readonly rand: () => number = Math.random) {}

  /** Call at the start of a bot's turn (turn-based) so it solves fresh. */
  newTurn(): void {
    this.solution = null;
    this.fired = false;
  }

  /**
   * Turn-based: rotate toward the solution, then fire once. Returns an intent.
   */
  turnIntent(world: World, bot: Tank, dt: number): Intent {
    const it = emptyIntent();
    if (this.fired) return it;
    if (!this.solution) {
      this.solution = decide(world, bot, this.rand);
      world.selectWeapon(bot, this.solution.weaponId);
    }
    const s = this.solution;
    const dA = s.angle - bot.angle;
    const dP = s.power - bot.power;
    // Steer at up to full speed, easing in as we approach.
    it.aimDelta = clamp(dA * 3, -1, 1);
    it.powerDelta = clamp(dP * 3, -1, 1);
    void dt;
    if (Math.abs(dA) < 0.6 && Math.abs(dP) < 0.8) {
      it.aimDelta = 0;
      it.powerDelta = 0;
      it.fire = true;
      this.fired = true;
    }
    return it;
  }

  /**
   * Arena: keep re-solving, drive toward crates or away from danger, and fire
   * whenever the barrel is on the solution and the cooldown allows.
   */
  arenaIntent(world: World, bot: Tank, dt: number): Intent {
    const it = emptyIntent();
    if (!bot.alive) return it;
    const profile = PROFILES[bot.difficulty];

    this.rethinkTimer -= dt;
    if (!this.solution || this.rethinkTimer <= 0) {
      this.solution = decide(world, bot, this.rand);
      world.selectWeapon(bot, this.solution.weaponId);
      this.rethinkTimer = profile.rethink * (0.7 + this.rand() * 0.6);
    }

    const s = this.solution;
    const dA = s.angle - bot.angle;
    const dP = s.power - bot.power;
    it.aimDelta = clamp(dA * 2.5, -1, 1);
    it.powerDelta = clamp(dP * 2.5, -1, 1);
    if (Math.abs(dA) < 1.2 && Math.abs(dP) < 1.5 && bot.cooldown <= 0) it.fire = true;

    // Movement: chase a nearby crate, otherwise wander a little to be harder to hit.
    const crate = nearestCrate(world, bot);
    if (crate && this.rand() < profile.greed && Math.abs(crate.x - bot.x) < 400) {
      it.moveX = Math.sign(crate.x - bot.x);
      this.rethinkTimer = Math.min(this.rethinkTimer, 0.4); // aim goes stale while moving
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderDir = this.rand() < 0.5 ? 0 : this.rand() < 0.5 ? -1 : 1;
        this.wanderTimer = 0.6 + this.rand() * 1.4;
      }
      it.moveX = this.wanderDir;
    }
    return it;
  }
}

// ---------------------------------------------------------------------------

export function decide(world: World, bot: Tank, rand: () => number): Solution {
  const profile = PROFILES[bot.difficulty];
  const target = pickTarget(world, bot, rand);
  const weapon = pickWeapon(world, bot, target, profile, rand);
  const best = solve(world, bot, target, weapon, profile, rand);

  const g = () => (rand() + rand() + rand() - 1.5) * 1.63;
  let angle = best.angle + g() * profile.angleNoise;
  let power = best.power + g() * profile.powerNoise;
  if (rand() < profile.lazy) {
    angle = bot.angle + g() * 6;
    power = bot.power + g() * 8;
  }
  return { angle: clamp(angle, 0, 180), power: clamp(power, 5, 100), weaponId: weapon.id, targetId: target.id, miss: best.miss };
}

function pickTarget(world: World, bot: Tank, rand: () => number): Damageable {
  const hard = world.hardpoints.filter((h) => h.alive);
  const others: Damageable[] = [...world.aliveTanks().filter((t) => t.index !== bot.index), ...hard];
  if (others.length === 0) return bot;
  if (others.length === 1) return others[0];
  const scored = others.map((t) => {
    const dist = Math.abs(t.x - bot.x);
    const hpScore = 1 - t.hp / t.maxHp;
    const distScore = 1 - dist / world.width;
    return { t, score: hpScore * 0.6 + distScore * 0.4 + rand() * 0.15 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].t;
}

function pickWeapon(world: World, bot: Tank, target: Damageable, profile: Profile, rand: () => number): Weapon {
  const owned = [...bot.ammo.entries()].filter(([, n]) => n !== 0).map(([id]) => weaponById(id));
  if (!profile.usesSpecials || owned.length === 1) return weaponById('shell');
  const dist = Math.abs(target.x - bot.x);
  const ranked = owned
    .map((w) => {
      let s = w.damage / 40 + w.radius / 60;
      if (w.behaviour === 'nuke' && dist < w.radius * 1.6) s -= 2;
      if (target.hp < 30 && w.cost > 1500) s -= 1;
      if (w.behaviour === 'railgun' && Math.abs(world.wind) > 40) s += 1;
      if (w.behaviour === 'roller' && world.terrain.surfaceY(target.x) > world.terrain.surfaceY(bot.x) + 30) s += 0.8;
      if (w.id === 'shell') s -= 0.4;
      return { w, s: s + rand() * 0.5 };
    })
    .sort((a, b) => b.s - a.s);
  return ranked[0].w;
}

function hitboxes(world: World): TankHitbox[] {
  const out: TankHitbox[] = [];
  for (const d of world.damageables()) {
    if (d.kind === 'crate') continue;
    out.push({
      index: d.kind === 'tank' ? d.owner : -2,
      x: d.x,
      y: d.kind === 'tank' ? d.y - d.halfHeight : d.y,
      halfWidth: d.halfWidth,
      halfHeight: d.halfHeight,
      alive: d.alive,
    });
  }
  return out;
}

function solve(world: World, bot: Tank, target: Damageable, weapon: Weapon, profile: Profile, rand: () => number) {
  const from = world.muzzle(bot);
  const aimAt = { x: target.x, y: target.kind === 'tank' ? target.y - target.halfHeight : target.y };
  const facingRight = target.x > bot.x;
  const opts = {
    wind: world.effectiveWind(bot),
    tanks: hitboxes(world),
    shooterIndex: bot.index,
    mapWidth: world.width,
    mapHeight: world.height,
    piercesTerrain: weapon.behaviour === 'railgun',
    maxSteps: 2400,
  };

  const evaluate = (angle: number, power: number): number => {
    const vel = launchVelocity(angle, power, weapon.speedScale);
    const r = simulateFlight(from, vel, world.terrain, opts, weapon.windFactor, weapon.gravityFactor);
    const at = r.impact.at;
    if (r.impact.kind === 'offmap' || r.impact.kind === 'expired') return 1e6;
    if (r.impact.kind === 'tank' && r.impact.tankIndex === bot.index) return 1e6;
    let miss = Math.hypot(at.x - aimAt.x, at.y - aimAt.y);
    if (r.impact.kind === 'tank' && Math.abs(at.x - aimAt.x) < target.halfWidth + 2) miss *= 0.2;
    const selfDist = Math.hypot(at.x - bot.x, at.y - bot.y);
    if (selfDist < weapon.radius * 1.3) miss += (weapon.radius * 1.3 - selfDist) * 4;
    return miss;
  };

  let best = { angle: facingRight ? 55 : 125, power: 55, miss: Infinity };
  for (let i = 0; i < profile.samples; i++) {
    const angle = facingRight ? 15 + rand() * 75 : 90 + rand() * 75;
    const power = 15 + rand() * 85;
    const miss = evaluate(angle, power);
    if (miss < best.miss) best = { angle, power, miss };
  }
  let spreadA = 8;
  let spreadP = 10;
  for (let pass = 0; pass < profile.refine; pass++) {
    const n = Math.max(20, Math.floor(profile.samples / 4));
    for (let i = 0; i < n; i++) {
      const angle = clamp(best.angle + (rand() * 2 - 1) * spreadA, 0, 180);
      const power = clamp(best.power + (rand() * 2 - 1) * spreadP, 5, 100);
      const miss = evaluate(angle, power);
      if (miss < best.miss) best = { angle, power, miss };
    }
    spreadA *= 0.45;
    spreadP *= 0.45;
  }
  return best;
}

function nearestCrate(world: World, bot: Tank) {
  let best = null as (typeof world.crates)[number] | null;
  let bd = Infinity;
  for (const c of world.crates) {
    if (!c.alive || !c.landed) continue;
    const d = Math.abs(c.x - bot.x);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Shop behaviour for turn-based modes. */
export function botShop(
  bot: Tank,
  modeId: string,
  buy: (t: Tank, id: string) => boolean,
  repairCost: (t: Tank) => number,
  repair: (t: Tank) => boolean,
): void {
  const profile = PROFILES[bot.difficulty];
  if (!profile.shops) return;
  if (bot.hp < bot.maxHp * 0.7 && bot.credits >= repairCost(bot) + 800) repair(bot);
  const wishlist = ['heavy', 'roller', 'cluster', 'sabot', 'digger', 'railgun', 'mirv', 'napalm', 'airburst', 'nuke'];
  for (const id of wishlist) {
    const w = weaponById(id);
    if (!w.modes.includes(modeId as never)) continue;
    const have = bot.ammo.get(id) ?? 0;
    if (have >= w.ammoPerBuy) continue;
    if (bot.credits - w.cost < 600) continue;
    buy(bot, id);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
