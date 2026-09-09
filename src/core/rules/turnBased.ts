/**
 * Turn-based rules (Classic / Modern / Advanced): one tank acts at a time,
 * the world runs until the shot has fully resolved, then the turn passes.
 */
import { World, type Tank } from '../world';
import { Terrain, TERRAIN_STYLES } from '../terrain';
import { gameMode } from '../modes';
import { tankClassById } from '../tanks';
import { hullForPlayer, startingAmmoFor } from '../characters';
import { buyWeapon, hullUpgradeCost, upgradeHull, HULL_UPGRADE_CAP, HULL_UPGRADE_COST, HULL_UPGRADE_STEP } from '../shop';
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
  /**
   * Character picked on the select screen. Outside the campaign only the fuel
   * bonus is applied — the rest of a commander's perk stays campaign-only — so
   * the six characters differ in range as well as hull.
   */
  commanderId?: string;
}

export interface TurnBasedConfig {
  mode: GameModeId;
  players: PlayerSetup[];
  rounds: number;
  seed: number;
  width: number;
  height: number;
  terrainStyle: string; // id or 'random'
  /** 'drop' lets the players choose where their tank lands each round. */
  placement: 'drop' | 'random';
}

export type Phase = 'placing' | 'aim' | 'resolving' | 'roundOver' | 'shop' | 'matchOver';

/** Closest two tanks may be dropped, and the dead margin at each map edge, in px. */
const PLACE_MIN_GAP = 110;
const PLACE_EDGE = 70;

/** Per-tank tallies across the whole match, for the end-of-match results screen. */
export interface MatchStats {
  shotsFired: number;
  hits: number;
  damageDealt: number;
  damageTaken: number;
}

/** Shared by TurnBasedMatch and ArenaMatch: read the world's pending damage/launch events
 * into a per-tank-index MatchStats map. Does not clear events — the renderer drains them. */
export function tallyMatchStats(world: World, stats: Map<number, MatchStats>): void {
  for (const e of world.peekEvents()) {
    if (e.kind === 'launch') {
      const s = stats.get(e.shooter);
      if (s) s.shotsFired += 1;
    } else if (e.kind === 'damage' && e.amount > 0) {
      const total = e.amount + e.shieldAbsorbed;
      const byStats = e.by >= 0 ? stats.get(e.by) : undefined;
      if (byStats) {
        byStats.hits += 1;
        byStats.damageDealt += total;
      }
      const target = world.tanks.find((t) => t.id === e.target);
      if (target) {
        const targetStats = stats.get(target.index);
        if (targetStats) targetStats.damageTaken += total;
      }
    }
  }
}

/** Match-level state a save game round-trips; the world is saved separately. */
export interface TurnBasedSnapshot {
  round: number;
  turn: number;
  current: number;
  shotsLeftThisTurn: number;
  lastRoundWinner: number;
  order: number[];
  rngState: number;
  stats: [number, MatchStats][];
}

export class TurnBasedMatch {
  readonly world: World;
  readonly config: TurnBasedConfig;
  readonly rng: Rng;
  /** Keyed by tank index. Populated in the constructor, one entry per tank. */
  readonly stats = new Map<number, MatchStats>();

  round = 0;
  turn = 0;
  current = 0;
  /** Tank indices in this round's play order — also the order they choose positions in. */
  order: number[] = [];
  private placeQueue: number[] = [];
  private slots = 0;
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
        cls: hullForPlayer(tankClassById(mode.tankClasses ? p.tankClass : 'line'), p),
        skin: p.skin,
        credits: mode.startCredits,
      }),
    );
    // The character kit, once at the start of the match. Ammo carries across
    // rounds from here, like anything bought in the shop.
    config.players.forEach((p, i) => {
      const t = this.world.tanks[i];
      for (const [wid, n] of startingAmmoFor(p.commanderId, mode.id)) t.ammo.set(wid, (t.ammo.get(wid) ?? 0) + n);
    });
    for (const t of this.world.tanks) this.stats.set(t.index, { shotsFired: 0, hits: 0, damageDealt: 0, damageTaken: 0 });
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
    if (this.round > 1) {
      // The tank with the worst standing tees off first — mirrors the original
      // Tank Wars rule that last round's loser goes first. The shuffle above
      // already randomised order, so a stable sort only breaks ties among tanks
      // level on rounds/kills.
      order.sort((a, b) => {
        const ta = this.world.tanks[a];
        const tb = this.world.tanks[b];
        return ta.roundsWon - tb.roundsWon || ta.kills - tb.kills;
      });
    }
    this.order = order;
    this.slots = n;
    for (const i of order) this.world.resetTankForRound(this.world.tanks[i]);
    this.world.rollWind();
    this.lastRoundWinner = -1;

    // Drop placement only makes sense with someone at the keyboard; an all-bot
    // match places itself and goes straight to aiming.
    if (this.config.placement === 'drop' && this.world.tanks.some((t) => !t.isBot)) {
      this.placeQueue = [...order];
      for (const i of order) this.world.unplaceTank(this.world.tanks[i]);
      this.phase = 'placing';
      this.advancePlacement();
      return;
    }
    order.forEach((tankIndex, slot) => this.world.placeTankAt(this.world.tanks[tankIndex], this.autoPlaceX(slot)));
    this.beginAiming();
  }

  // ---- save games --------------------------------------------------------------

  snapshotState(): TurnBasedSnapshot {
    return {
      round: this.round,
      turn: this.turn,
      current: this.current,
      shotsLeftThisTurn: this.shotsLeftThisTurn,
      lastRoundWinner: this.lastRoundWinner,
      order: [...this.order],
      rngState: this.rng.seedState,
      stats: [...this.stats.entries()].map(([i, v]) => [i, { ...v }] as [number, MatchStats]),
    };
  }

  /**
   * Overwrite the match state after the constructor has built a fresh round.
   * Placement and firing are both finished by definition — only the 'aim' phase
   * is saveable — so the queues are cleared rather than restored.
   */
  restoreState(s: TurnBasedSnapshot): void {
    this.round = s.round;
    this.turn = s.turn;
    this.current = s.current;
    this.shotsLeftThisTurn = s.shotsLeftThisTurn;
    this.lastRoundWinner = s.lastRoundWinner;
    this.order = [...s.order];
    this.slots = this.world.tanks.length;
    this.rng.seedState = s.rngState;
    this.stats.clear();
    for (const [i, v] of s.stats) this.stats.set(i, { ...v });
    this.placeQueue = [];
    this.settleTimer = 0;
    this.driveAccum = 0;
    this.phase = 'aim';
    this.matchWinner = -1;
  }

  // ---- placement ---------------------------------------------------------------

  /** Tank index currently choosing a position, or -1 when nobody is. */
  get placingIndex(): number {
    return this.phase === 'placing' ? this.placeQueue[0] ?? -1 : -1;
  }

  get placingTank(): Tank | null {
    const i = this.placingIndex;
    return i >= 0 ? this.world.tanks[i] : null;
  }

  /** Legal x range for a drop, before the gap-to-neighbours rule. */
  placeBounds(): { min: number; max: number } {
    return { min: PLACE_EDGE, max: this.config.width - PLACE_EDGE };
  }

  /** A drop is legal if it is in bounds and not crowding a tank already down. */
  canPlaceAt(x: number): boolean {
    const { min, max } = this.placeBounds();
    if (x < min || x > max) return false;
    return this.world.tanks.every((t) => !t.placed || Math.abs(t.x - x) >= PLACE_MIN_GAP);
  }

  /** Commit the current chooser's drop. Returns false if the spot is not legal. */
  placeAt(x: number): boolean {
    if (this.phase !== 'placing') return false;
    const idx = this.placeQueue[0];
    if (idx === undefined) return false;
    const rounded = Math.round(x);
    if (!this.canPlaceAt(rounded)) return false;
    this.world.placeTankAt(this.world.tanks[idx], rounded);
    this.placeQueue.shift();
    this.advancePlacement();
    return true;
  }

  /** Drop every bot at the head of the queue; stop at a human or when done. */
  private advancePlacement(): void {
    while (this.placeQueue.length > 0) {
      const idx = this.placeQueue[0];
      const t = this.world.tanks[idx];
      if (!t.isBot) return;
      this.world.placeTankAt(t, this.autoPlaceX(this.order.indexOf(idx)));
      this.placeQueue.shift();
    }
    this.beginAiming();
  }

  /**
   * Spread slot `slot` of `slots` across the map with a little jitter, then walk
   * outwards until the spot clears everyone already down.
   */
  private autoPlaceX(slot: number): number {
    const margin = 180;
    const span = this.config.width - margin * 2;
    const centre = margin + (span * (slot + 0.5)) / Math.max(1, this.slots);
    const wanted = Math.round(centre + this.rng.range(-span / this.slots / 4, span / this.slots / 4));
    if (this.canPlaceAt(wanted)) return wanted;
    const { min, max } = this.placeBounds();
    for (let step = 8; step < this.config.width; step += 8) {
      if (this.canPlaceAt(wanted - step)) return wanted - step;
      if (this.canPlaceAt(wanted + step)) return wanted + step;
    }
    return Math.max(min, Math.min(max, wanted));
  }

  /**
   * Placement done: whoever chose first shoots first, which is also the
   * worst-standing-first order startRound() built.
   */
  private beginAiming(): void {
    this.current = this.order[0];
    this.shotsLeftThisTurn = this.currentTank.cls.shots;
    this.phase = 'aim';
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
        // Accumulate fractional pixels so slow drives still move. Lowered from
        // 60 on feedback that Advanced-mode driving was still too fast.
        this.driveAccum += intent.moveX * 40 * dt;
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
    } else if (this.phase === 'resolving' && this.mode.movement && intent.moveX !== 0) {
      // The shot is away but the turn is not over: the shooter can still spend
      // fuel while it flies, which is what makes a long lob a commitment.
      const t = this.currentTank;
      this.driveAccum += intent.moveX * 40 * dt;
      const whole = Math.trunc(this.driveAccum);
      if (whole !== 0) {
        w.drive(t, whole, true);
        this.driveAccum -= whole;
      }
    }
    w.step(dt);
    this.tally();

    if (this.phase === 'resolving' && !w.busy) {
      this.settleTimer += dt;
      if (this.settleTimer > 0.8) this.afterShot();
    }
  }
  private driveAccum = 0;

  private tally(): void {
    tallyMatchStats(this.world, this.stats);
  }

  private afterShot(): void {
    const alive = this.world.aliveTanks();
    if (alive.length <= 1) {
      this.lastRoundWinner = alive.length === 1 ? alive[0].index : -1;
      if (alive.length === 1) {
        alive[0].roundsWon += 1;
        alive[0].credits += this.mode.survivalReward;
      }
      // Losing a round should not mean skipping the armoury entirely: everyone
      // who did not win takes a consolation. A draw pays all of them.
      for (const t of this.world.tanks) {
        if (t.index !== this.lastRoundWinner) t.credits += this.mode.lossReward;
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
    return buyWeapon(t, this.mode.id, weaponId);
  }

  /** Re-exported so the shop UI can read them without importing the rules module. */
  static readonly HULL_UPGRADE_STEP = HULL_UPGRADE_STEP;
  static readonly HULL_UPGRADE_COST = HULL_UPGRADE_COST;
  static readonly HULL_UPGRADE_CAP = HULL_UPGRADE_CAP;

  hullUpgradeCost(t: Tank): number {
    return hullUpgradeCost(t);
  }

  upgradeHull(t: Tank): boolean {
    return upgradeHull(t);
  }

  finishShop(): void {
    if (this.phase !== 'shop') return;
    this.startRound();
  }
}
