/**
 * On-screen controls for fingers. Produces the same Intent fields the keyboard
 * does, so the rules layers never know which one they are talking to.
 *
 * The model is direct manipulation rather than a virtual gamepad:
 *   - touch anywhere that is not a pad and drag: the barrel follows the finger;
 *   - hold the FIRE pad: power charges, lifting fires — a short tap is ignored
 *     so a stray touch cannot waste a turn. Nothing else fires;
 *   - two drive pads when the mode has fuel, a weapon pad, and a tap on the
 *     HUD rack all do what their keys do.
 *
 * Aim is written straight onto the tank (an absolute angle, not a delta); drive,
 * fire and weapon come back through intent(). Fire only reports held once the
 * finger has been down long enough to count, which is what turns the existing
 * hold-to-charge code into a tap filter for free.
 */
import Phaser from 'phaser';
import { PAL, hex } from '../core/palette';
import { hullRotation, type Tank, type World } from '../core/world';
import { weaponById } from '../core/weapons';
import { HUD_H, NATIVE_H, NATIVE_W } from './config';
import { aimAngleFrom, classifyTouch, FIRE_MIN_HOLD_MS, type Gesture, type HitRect, type Pt } from './touchMath';

export interface TouchIntent {
  /** Same unions as Intent, so the fields merge without a cast. */
  moveX: 0 | 1 | -1;
  fireHeld: boolean;
  cycleWeapon: 0 | 1 | -1;
}

interface ActiveTouch {
  gesture: Gesture;
  startedAt: number;
  at: Pt;
}

const FONT = 'monospace';
const DEPTH = 180;

export class TouchControls {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly dyn: Phaser.GameObjects.Graphics;
  private readonly labels = new Map<string, Phaser.GameObjects.Text>();
  private readonly readout: Phaser.GameObjects.Text;
  private readonly wind: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly buttons: HitRect[];
  private readonly touches = new Map<number, ActiveTouch>();
  private target: Tank | null = null;
  private enabled = false;
  private cycleQueued: 0 | 1 = 0;
  /** Set once the shot is away: a drag may still drive, but not move the barrel. */
  private aimLocked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    private readonly opts: { movement: boolean; realTime: boolean; onMenu: () => void },
  ) {
    // Two extra pointers: drive with one thumb, aim or fire with the other.
    scene.input.addPointer(2);

    const pad = 180;
    const bottom = NATIVE_H - 50;
    this.buttons = [];
    if (opts.movement) {
      this.buttons.push({ id: 'left', x: 70, y: bottom - pad, w: pad, h: pad });
      this.buttons.push({ id: 'right', x: 70 + pad + 30, y: bottom - pad, w: pad, h: pad });
    }
    this.buttons.push({ id: 'weapon', x: NATIVE_W / 2 - 170, y: bottom - 100, w: 340, h: 100 });
    this.buttons.push({ id: 'fire', x: NATIVE_W - 70 - 220, y: bottom - 220, w: 220, h: 220 });
    // Without a keyboard this is the only way to reach the pause / leave prompt.
    // Sits under the fullscreen button the page draws in the corner.
    this.buttons.push({ id: 'menu', x: NATIVE_W - 40 - 170, y: HUD_H + 100, w: 170, h: 56 });

    this.gfx = scene.add.graphics().setDepth(DEPTH).setScrollFactor(0);
    this.dyn = scene.add.graphics().setDepth(DEPTH + 1).setScrollFactor(0);
    for (const b of this.buttons) {
      const text = b.id === 'left' ? '◄' : b.id === 'right' ? '►' : b.id === 'fire' ? 'FIRE\nhold' : b.id === 'menu' ? '▌▌ MENU' : 'WEAPON';
      const size = b.id === 'weapon' || b.id === 'menu' ? '22px' : '40px';
      const t = scene.add
        .text(b.x + b.w / 2, b.y + b.h / 2, text, { fontFamily: FONT, fontSize: size, color: hex(PAL.uiText), align: 'center' })
        .setOrigin(0.5)
        .setDepth(DEPTH + 2)
        .setScrollFactor(0);
      this.labels.set(b.id, t);
    }
    // Big readouts over the sky: the HUD strip is too small to read on a phone.
    this.readout = scene.add
      .text(40, HUD_H + 18, '', { fontFamily: FONT, fontSize: '34px', color: hex(PAL.uiText), stroke: hex(PAL.uiInk), strokeThickness: 6 })
      .setDepth(DEPTH + 2)
      .setScrollFactor(0);
    this.wind = scene.add
      .text(NATIVE_W - 130, HUD_H + 18, '', { fontFamily: FONT, fontSize: '34px', color: hex(PAL.uiText), stroke: hex(PAL.uiInk), strokeThickness: 6 })
      .setOrigin(1, 0)
      .setDepth(DEPTH + 2)
      .setScrollFactor(0);
    this.hint = scene.add
      .text(NATIVE_W / 2, HUD_H + 24, '', { fontFamily: FONT, fontSize: '20px', color: hex(PAL.uiTextDim), stroke: hex(PAL.uiInk), strokeThickness: 4, align: 'center' })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH + 2)
      .setScrollFactor(0);

    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
    this.paintStatic();
  }

  /** The tank whose barrel a drag moves and whose surroundings are the dead zone. */
  setTarget(t: Tank | null): void {
    this.target = t;
  }

  /** The HUD rack tap and anything else that wants "next weapon" without a pad. */
  queueCycle(): void {
    this.cycleQueued = 1;
  }

  setAimLocked(locked: boolean): void {
    this.aimLocked = locked;
  }

  /** Off while a card, the pause menu, placement or a replay owns the screen. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) this.touches.clear();
    const vis = on;
    this.gfx.setVisible(vis);
    this.dyn.setVisible(vis);
    this.labels.forEach((l) => l.setVisible(vis));
    this.readout.setVisible(vis);
    this.wind.setVisible(vis);
    this.hint.setVisible(vis);
  }

  /** Drive / fire / weapon for this frame. Aim has already been applied to the tank. */
  intent(now = this.scene.time.now): TouchIntent {
    const out: TouchIntent = { moveX: 0, fireHeld: false, cycleWeapon: this.cycleQueued };
    this.cycleQueued = 0;
    if (!this.enabled) return out;
    let move = 0;
    for (const t of this.touches.values()) {
      if (t.gesture.kind === 'button' && t.gesture.id === 'left') move -= 1;
      else if (t.gesture.kind === 'button' && t.gesture.id === 'right') move += 1;
      else if (t.gesture.kind === 'button' && t.gesture.id === 'fire') {
        // Held only once it has been down long enough to be a hold, not a tap.
        if (now - t.startedAt >= FIRE_MIN_HOLD_MS) out.fireHeld = true;
      }
    }
    // Both pads at once cancel out, like holding A and D.
    out.moveX = move > 0 ? 1 : move < 0 ? -1 : 0;
    return out;
  }

  update(): void {
    if (!this.enabled) return;
    const t = this.target;
    this.dyn.clear();
    if (t) {
      const w = weaponById(t.selectedWeapon);
      const n = this.world.ammoFor(t, w.id);
      this.readout.setText(`ANG ${Math.round(t.angle)}°   PWR ${Math.round(t.power)}`);
      this.labels.get('weapon')?.setText(`${w.name.toUpperCase()}  ${n < 0 ? '∞' : '×' + n}`);
    } else {
      this.readout.setText('');
    }
    const wv = this.world.wind;
    this.wind.setText(`WIND ${wv > 0 ? '→' : wv < 0 ? '←' : '·'} ${Math.abs(wv)}`);

    const now = this.scene.time.now;
    for (const a of this.touches.values()) {
      if (a.gesture.kind === 'aim' && t) {
        const p = this.pivotScreen(t);
        this.dyn.lineStyle(3, PAL.glow, 0.7).lineBetween(p.x, p.y, a.at.x, a.at.y);
        this.dyn.fillStyle(PAL.glow, 0.9).fillCircle(a.at.x, a.at.y, 10);
      } else if (a.gesture.kind === 'button' && a.gesture.id === 'fire' && t) {
        const held = now - a.startedAt;
        const armed = held >= FIRE_MIN_HOLD_MS;
        // Ring round the FIRE pad that fills with the power the shot has charged to.
        const pad = this.buttons.find((b) => b.id === 'fire')!;
        const cx = pad.x + pad.w / 2;
        const cy = pad.y + pad.h / 2;
        const r = pad.w / 2 + 10;
        const frac = Math.max(0, Math.min(1, (t.power - 20) / 80));
        this.dyn.lineStyle(4, armed ? PAL.fireHot : PAL.uiTextDim, 0.35).strokeCircle(cx, cy, r);
        if (armed) {
          this.dyn.lineStyle(8, PAL.fireHot, 0.95);
          this.dyn.beginPath();
          this.dyn.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
          this.dyn.strokePath();
        }
      }
    }
    // Drive pads light while held.
    for (const b of this.buttons) {
      const held = [...this.touches.values()].some((a) => a.gesture.kind === 'button' && a.gesture.id === b.id);
      if (held) this.dyn.fillStyle(PAL.uiEdge, 0.22).fillRoundedRect(b.x, b.y, b.w, b.h, 14);
    }
  }

  setHint(text: string): void {
    this.hint.setText(text);
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onDown, this);
    this.scene.input.off('pointermove', this.onMove, this);
    this.scene.input.off('pointerup', this.onUp, this);
    this.scene.input.off('pointerupoutside', this.onUp, this);
    this.gfx.destroy();
    this.dyn.destroy();
    this.labels.forEach((l) => l.destroy());
    this.readout.destroy();
    this.wind.destroy();
    this.hint.destroy();
  }

  // ---- pointer plumbing --------------------------------------------------------

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.enabled) return;
    const at = { x: p.x, y: p.y };
    const t = this.target;
    const g = classifyTouch(at, this.buttons);
    if (g.kind === 'button' && g.id === 'weapon') {
      this.cycleQueued = 1;
      this.touches.set(p.id, { gesture: g, startedAt: this.scene.time.now, at });
      return;
    }
    if (g.kind === 'button' && g.id === 'menu') {
      // Not tracked as a touch: the prompt disables this layer on its next frame.
      this.opts.onMenu();
      return;
    }
    this.touches.set(p.id, { gesture: g, startedAt: this.scene.time.now, at });
    if (g.kind === 'aim' && t) this.applyAim(t, at);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const a = this.touches.get(p.id);
    if (!a) return;
    a.at = { x: p.x, y: p.y };
    if (a.gesture.kind === 'aim' && this.target) this.applyAim(this.target, a.at);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    this.touches.delete(p.id);
  }

  private applyAim(t: Tank, finger: Pt): void {
    if (this.aimLocked) return;
    const angle = aimAngleFrom(this.pivotScreen(t), finger);
    // Turn-based hulls turn to face the shot like they do for the keys; in real
    // time the hull faces the way it drives, so the barrel is set on its own.
    this.world.aim(t, angle, !this.opts.realTime);
  }

  /** Barrel pivot in screen coordinates — the same point the renderer draws from. */
  private pivotScreen(t: Tank): Pt {
    if (t.barrelLen <= 0) return { x: t.x, y: t.y + HUD_H - t.halfHeight * 2 - 2 };
    const rot = hullRotation(t);
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    const lx = t.pivotDX * t.facing;
    const ly = t.pivotDY;
    return { x: t.x + lx * ca - ly * sa, y: t.y + lx * sa + ly * ca + HUD_H };
  }

  private paintStatic(): void {
    this.gfx.clear();
    for (const b of this.buttons) {
      this.gfx.fillStyle(PAL.uiInk, 0.55).fillRoundedRect(b.x, b.y, b.w, b.h, 14);
      this.gfx.lineStyle(3, b.id === 'fire' ? PAL.fireHot : PAL.uiEdge, 0.8).strokeRoundedRect(b.x, b.y, b.w, b.h, 14);
    }
  }
}
