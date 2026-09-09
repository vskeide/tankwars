/**
 * Real-time rules ("Arena"): every tank acts every frame, weapons have
 * cooldowns, crates parachute in, last hull standing wins the round.
 * Hotseat on one keyboard: each player's Intent comes from its own key set.
 */
import { World, type Tank, type CrateKind, AIM_SPEED, POWER_SPEED, DRIVE_SPEED } from '../world';
import { Terrain, TERRAIN_STYLES } from '../terrain';
import { gameMode } from '../modes';
import { tankClassById } from '../tanks';
import { weaponById, weaponsForMode } from '../weapons';
import { Rng } from '../rng';
import type { Intent } from '../input';
import { tallyMatchStats, type MatchStats, type PlayerSetup } from './turnBased';

export interface ArenaConfig {
  players: PlayerSetup[];
  rounds: number;
  seed: number;
  width: number;
  height: number;
  terrainStyle: string;
  /** Seconds between crate drops. */
  crateInterval: number;
  /** Seconds between wind changes. */
  windInterval: number;
}

export type ArenaPhase = 'countdown' | 'live' | 'roundOver' | 'matchOver';

/** Base cooldown per weapon behaviour, seconds. Heavier ordnance reloads slower. */
function cooldownFor(weaponId: string): number {
  const w = weaponById(weaponId);
  if (w.id === 'shell') return 1.1;
  if (w.behaviour === 'nuke') return 4.5;
  if (w.behaviour === 'mirv' || w.behaviour === 'cluster') return 2.6;
  return 1.8;
}

export class ArenaMatch {
  readonly world: World;
  readonly config: ArenaConfig;
  readonly rng: Rng;
  readonly stats = new Map<number, MatchStats>();

  round = 0;
  phase: ArenaPhase = 'countdown';
  countdown = 3;
  lastRoundWinner = -1;
  matchWinner = -1;
  private crateTimer = 0;
  private windTimer = 0;
  private overTimer = 0;
  private driveAccum: number[] = [];

  constructor(config: ArenaConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    // Arena borrows the Advanced rule set (all weapons, perks, movement) with
    // per-turn wind semantics reinterpreted as timed wind.
    const mode = { ...gameMode('advanced'), id: 'advanced' as const, retainAim: true };
    this.world = new World({ width: config.width, height: config.height, mode, seed: this.rng.int(1, 2 ** 31 - 1) });
    config.players.forEach((p, i) =>
      this.world.addTank({
        index: i,
        name: p.name,
        colour: p.colour,
        isBot: p.isBot,
        difficulty: p.difficulty,
        cls: tankClassById(p.tankClass),
        skin: p.skin,
        credits: 0,
      }),
    );
    for (const t of this.world.tanks) this.stats.set(t.index, { shotsFired: 0, hits: 0, damageDealt: 0, damageTaken: 0 });
    this.driveAccum = config.players.map(() => 0);
    this.startRound();
  }

  startRound(): void {
    this.round += 1;
    const styleId = this.config.terrainStyle;
    const style =
      styleId === 'random' ? this.rng.pick(TERRAIN_STYLES) : TERRAIN_STYLES.find((s) => s.id === styleId) ?? TERRAIN_STYLES[0];
    this.world.setTerrain(Terrain.generate(this.config.width, this.config.height, style, this.rng.int(1, 2 ** 31 - 1)));

    const n = this.world.tanks.length;
    const margin = 220;
    const span = this.config.width - margin * 2;
    const order = this.world.tanks.map((t) => t.index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((idx, slot) => {
      const x = Math.round(margin + (span * (slot + 0.5)) / n);
      this.world.respawnTank(this.world.tanks[idx], x);
      // Everyone starts with a small kit in arena.
      const t = this.world.tanks[idx];
      t.ammo.clear();
      t.ammo.set('shell', -1);
      t.ammo.set('heavy', 3);
      t.selectedWeapon = 'shell';
    });
    this.world.rollWind();
    this.phase = 'countdown';
    this.countdown = 3;
    this.crateTimer = this.config.crateInterval * 0.5;
    this.windTimer = this.config.windInterval;
    this.lastRoundWinner = -1;
  }

  /** Apply every player's intent for this frame and advance the world. */
  update(intents: readonly Intent[], dt: number): void {
    const w = this.world;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'live';
      // Allow aiming during countdown, no moving or firing.
      w.tanks.forEach((t, i) => this.applyAim(t, intents[i], dt));
      return;
    }

    if (this.phase === 'live') {
      w.tanks.forEach((t, i) => {
        if (!t.alive) return;
        const it = intents[i];
        if (!it) return;
        this.applyAim(t, it, dt);
        if (it.cycleWeapon !== 0) w.cycleWeapon(t, it.cycleWeapon);
        if (it.moveX !== 0) {
          w.face(t, it.moveX > 0 ? 1 : -1);
          this.driveAccum[i] += it.moveX * DRIVE_SPEED * dt;
          const whole = Math.trunc(this.driveAccum[i]);
          if (whole !== 0) {
            w.drive(t, whole, false);
            this.driveAccum[i] -= whole;
          }
        }
        if ((it.fire || it.fireHeld) && t.cooldown <= 0) {
          if (w.fire(t)) t.cooldown = cooldownFor(t.selectedWeapon);
        }
      });

      this.crateTimer -= dt;
      if (this.crateTimer <= 0) {
        this.dropCrate();
        this.crateTimer = this.config.crateInterval * this.rng.range(0.7, 1.3);
      }
      this.windTimer -= dt;
      if (this.windTimer <= 0) {
        w.rollWind();
        this.windTimer = this.config.windInterval;
      }
    }

    w.step(dt);
    tallyMatchStats(w, this.stats);

    if (this.phase === 'live') {
      const alive = w.aliveTanks();
      if (alive.length <= 1) {
        this.lastRoundWinner = alive.length === 1 ? alive[0].index : -1;
        if (alive.length === 1) alive[0].roundsWon += 1;
        this.phase = 'roundOver';
        this.overTimer = 0;
      }
    } else if (this.phase === 'roundOver') {
      this.overTimer += dt;
    }
  }

  private applyAim(t: Tank, it: Intent | undefined, dt: number): void {
    if (!it || !t.alive) return;
    if (it.aimDelta !== 0) this.world.aimElevation(t, it.aimDelta * AIM_SPEED * dt);
    if (it.powerDelta !== 0) this.world.setPower(t, t.power + it.powerDelta * POWER_SPEED * dt);
  }

  private dropCrate(): void {
    const kinds: CrateKind[] = ['weapon', 'weapon', 'weapon', 'repair', 'shield', 'ammo'];
    const kind = this.rng.pick(kinds);
    let payload = '';
    if (kind === 'weapon' || kind === 'ammo') {
      const pool = weaponsForMode('advanced').filter((w) => w.cost > 0 && w.behaviour !== 'nuke');
      payload = this.rng.pick(pool).id;
    }
    // Drop somewhere between the outermost tanks, never right on top of one.
    const alive = this.world.aliveTanks();
    const xs = alive.map((t) => t.x);
    const lo = Math.max(120, Math.min(...xs) - 240);
    const hi = Math.min(this.config.width - 120, Math.max(...xs) + 240);
    let x = this.rng.range(lo, hi);
    for (let tries = 0; tries < 8; tries++) {
      if (alive.every((t) => Math.abs(t.x - x) > 140)) break;
      x = this.rng.range(lo, hi);
    }
    this.world.spawnCrate(Math.round(x), kind, payload);
  }

  /** Renderer calls this once the round-over card has been shown long enough. */
  proceedFromRoundOver(): void {
    if (this.phase !== 'roundOver') return;
    if (this.round >= this.config.rounds) {
      this.phase = 'matchOver';
      let best = -1;
      let bestScore = -1;
      for (const t of this.world.tanks) {
        const s = t.roundsWon * 1000 + t.kills;
        if (s > bestScore) {
          bestScore = s;
          best = t.index;
        }
      }
      this.matchWinner = best;
      return;
    }
    this.startRound();
  }

  get roundOverElapsed(): number {
    return this.overTimer;
  }
}
