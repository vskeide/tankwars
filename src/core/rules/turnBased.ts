/**
 * Turn-based rules (Classic / Modern / Advanced): one tank acts at a time,
 * the world runs until the shot has fully resolved, then the turn passes.
 */
import { World, type Tank } from '../world';
import { Terrain, TERRAIN_STYLES } from '../terrain';
import { gameMode } from '../modes';
import { tankClassById } from '../tanks';
import { weaponById } from '../weapons';
import { Rng } from '../rng';
import { AIM_SPEED, POWER_SPEED } from '../world';
import type { Intent } from '../input';
import type { Difficulty, GameModeId } from '../types';

export interface PlayerSetup {
  name: string;
  colour: number;
  isBot: boolean;
  difficulty: Difficulty;
  tankClass: string;
  skin?: string;
}

export interface TurnBasedConfig {
  mode: GameModeId;
  players: PlayerSetup[];
  rounds: number;
  seed: number;
  width: number;
  height: number;
  terrainStyle: string; // id or 'random'
}

export type Phase = 'aim' | 'resolving' | 'roundOver' | 'shop' | 'matchOver';

export class TurnBasedMatch {
  readonly world: World;
  readonly config: TurnBasedConfig;
  readonly rng: Rng;

  round = 0;
  turn = 0;
  current = 0;
  phase: Phase = 'aim';
  shotsLeftThisTurn = 1;
  lastRoundWinner = -1;
  matchWinner = -1;
  /** Seconds the world has been idle after a shot — small pause before passing the turn. */
  private settleTimer = 0;

  constructor(config: TurnBasedConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    const mode = gameMode(config.mode);
    this.world = new World({ width: config.width, height: config.height, mode, seed: this.rng.int(1, 2 ** 31 - 1) });
    config.players.forEach((p, i) =>
      this.world.addTank({
        index: i,
        name: p.name,
        colour: p.colour,
        isBot: p.isBot,
        difficulty: p.difficulty,
        cls: tankClassById(mode.tankClasses ? p.tankClass : 'line'),
        skin: p.skin,
        credits: mode.startCredits,
      }),
    );
    this.startRound();
  }

  get mode() {
    return this.world.mode;
  }
  get currentTank(): Tank {
    return this.world.tanks[this.current];
  }

  startRound(): void {
    this.round += 1;
    this.turn = 0;
    const styleId = this.config.terrainStyle;
    const style =
      styleId === 'random' ? this.rng.pick(TERRAIN_STYLES) : TERRAIN_STYLES.find((s) => s.id === styleId) ?? TERRAIN_STYLES[0];
    this.world.setTerrain(Terrain.generate(this.config.width, this.config.height, style, this.rng.int(1, 2 ** 31 - 1)));

    const n = this.world.tanks.length;
    const order = this.world.tanks.map((t) => t.index);
    for (let i = order.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const margin = 180;
    const span = this.config.width - margin * 2;
    order.forEach((tankIndex, slot) => {
      const centre = margin + (span * (slot + 0.5)) / n;
      const x = Math.round(centre + this.rng.range(-span / n / 4, span / n / 4));
      this.world.respawnTank(this.world.tanks[tankIndex], x);
    });

    this.world.rollWind();
    this.current = order[0];
    this.shotsLeftThisTurn = this.currentTank.cls.shots;
    this.phase = 'aim';
    this.lastRoundWinner = -1;
  }

  /**
   * Apply the current player's intent for one frame and advance the world.
   * Called every simulation step by the scene.
   */
  update(intent: Intent, dt: number): void {
    const w = this.world;
    if (this.phase === 'aim') {
      const t = this.currentTank;
      if (intent.aimDelta !== 0) w.aim(t, t.angle + intent.aimDelta * AIM_SPEED * dt);
      if (intent.powerDelta !== 0) w.setPower(t, t.power + intent.powerDelta * POWER_SPEED * dt);
      if (intent.cycleWeapon !== 0) w.cycleWeapon(t, intent.cycleWeapon);
      if (intent.moveX !== 0 && this.mode.movement) {
        // Accumulate fractional pixels so slow drives still move.
        this.driveAccum += intent.moveX * 60 * dt;
        const whole = Math.trunc(this.driveAccum);
        if (whole !== 0) {
          w.drive(t, whole, true);
          this.driveAccum -= whole;
        }
      }
      if (intent.fire && w.fire(t)) {
        this.phase = 'resolving';
        this.settleTimer = 0;
      }
    }
    w.step(dt);

    if (this.phase === 'resolving' && !w.busy) {
      this.settleTimer += dt;
      if (this.settleTimer > 0.8) this.afterShot();
    }
  }
  private driveAccum = 0;

  private afterShot(): void {
    const alive = this.world.aliveTanks();
    if (alive.length <= 1) {
      this.lastRoundWinner = alive.length === 1 ? alive[0].index : -1;
      if (alive.length === 1) {
        alive[0].roundsWon += 1;
        alive[0].credits += this.mode.survivalReward;
      }
      this.phase = 'roundOver';
      return;
    }
    this.shotsLeftThisTurn -= 1;
    if (this.shotsLeftThisTurn > 0 && this.currentTank.alive) {
      this.phase = 'aim';
      return;
    }
    this.nextTurn();
  }

  private nextTurn(): void {
    this.turn += 1;
    let next = this.current;
    for (let i = 0; i < this.world.tanks.length; i++) {
      next = (next + 1) % this.world.tanks.length;
      if (this.world.tanks[next].alive) break;
    }
    this.current = next;
    const t = this.currentTank;
    this.shotsLeftThisTurn = t.cls.shots;
    t.fuel = t.cls.fuel;
    t.movedThisTurn = false;
    if (this.mode.perks && t.cls.perk.kind === 'shield') {
      t.shield = Math.min(t.cls.perk.capacity, t.shield + t.cls.perk.regen);
    }
    if (this.mode.windPerTurn) this.world.rollWind();
    this.phase = 'aim';
  }

  proceedFromRoundOver(): void {
    if (this.phase !== 'roundOver') return;
    if (this.round >= this.config.rounds) {
      this.phase = 'matchOver';
      let best = -1;
      let bestScore = -1;
      for (const t of this.world.tanks) {
        const score = t.roundsWon * 1000 + t.kills;
        if (score > bestScore) {
          bestScore = score;
          best = t.index;
        }
      }
      this.matchWinner = best;
      return;
    }
    if (this.mode.shop) this.phase = 'shop';
    else this.startRound();
  }

  // ---- shop ------------------------------------------------------------------

  buy(t: Tank, weaponId: string): boolean {
    const w = weaponById(weaponId);
    if (!w.modes.includes(this.mode.id) || w.cost === 0 || t.credits < w.cost) return false;
    t.credits -= w.cost;
    const have = t.ammo.get(w.id) ?? 0;
    t.ammo.set(w.id, have < 0 ? -1 : have + w.ammoPerBuy);
    return true;
  }

  repairCost(t: Tank): number {
    return Math.ceil((t.maxHp - t.hp) * 8);
  }

  repair(t: Tank): boolean {
    const cost = this.repairCost(t);
    if (cost <= 0 || t.credits < cost) return false;
    t.credits -= cost;
    t.hp = t.maxHp;
    return true;
  }

  finishShop(): void {
    if (this.phase !== 'shop') return;
    this.startRound();
  }
}
