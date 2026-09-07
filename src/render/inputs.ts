/**
 * Turns keyboard sets and gamepads into per-player Intents. Edge detection for
 * fire/cycle/jump lives here so the rules layers only see clean edges.
 */
import Phaser from 'phaser';
import { KEY_SETS, emptyIntent, type Intent, type KeySet } from '../core/input';

interface SlotState {
  keys: KeySet | null;
  padIndex: number; // -1 = none
  prevFire: boolean;
  prevCycle: boolean;
  prevCycleBack: boolean;
  prevJump: boolean;
}

export class InputRouter {
  private readonly down = new Set<string>();
  private readonly slots: SlotState[] = [];

  constructor(private scene: Phaser.Scene, slotCount: number) {
    for (let i = 0; i < slotCount; i++) {
      this.slots.push({ keys: KEY_SETS[i] ?? null, padIndex: -1, prevFire: false, prevCycle: false, prevCycleBack: false, prevJump: false });
    }
    const kb = scene.input.keyboard;
    if (kb) {
      kb.on('keydown', (e: KeyboardEvent) => {
        this.down.add(e.code);
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      });
      kb.on('keyup', (e: KeyboardEvent) => this.down.delete(e.code));
    }
    scene.input.gamepad?.on('connected', (pad: Phaser.Input.Gamepad.Gamepad) => {
      const free = this.slots.find((s) => s.padIndex === -1);
      if (free) free.padIndex = pad.index;
    });
  }

  /** In turn-based play every human uses the SAME keys (slot 0) — hotseat. */
  sharedIntent(): Intent {
    return this.readSlot(this.slots[0], this.slots[0].keys ?? KEY_SETS[0], true);
  }

  /** Real-time: each slot's own key set / pad. */
  slotIntent(slot: number): Intent {
    const s = this.slots[slot];
    if (!s) return emptyIntent();
    return this.readSlot(s, s.keys ?? KEY_SETS[slot % KEY_SETS.length], false);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  private readSlot(s: SlotState, keys: KeySet, allowAnyKeys: boolean): Intent {
    const it = emptyIntent();
    const kd = (code: string) => this.down.has(code);
    // In hotseat turn-based, accept every layout so the arrows + WASD both work.
    const sets: KeySet[] = allowAnyKeys ? [...KEY_SETS] : [keys];
    let left = false, right = false, up = false, down = false, fire = false, cycle = false, cycleBack = false, jump = false;
    for (const k of sets) {
      left ||= kd(k.left);
      right ||= kd(k.right);
      up ||= kd(k.up);
      down ||= kd(k.down);
      fire ||= kd(k.fire);
      cycle ||= kd(k.cycle);
      jump ||= kd(k.jump);
    }
    if (allowAnyKeys) {
      cycleBack = kd('Tab') && kd('ShiftLeft');
      cycle ||= kd('Tab') && !kd('ShiftLeft');
      // Fine adjust with brackets / comma-period in hotseat.
      if (kd('BracketLeft') || kd('Comma')) it.powerDelta -= 0.35;
      if (kd('BracketRight') || kd('Period')) it.powerDelta += 0.35;
    }

    // Keyboard: left/right = move in arena, aim in turn-based (handled by the scene:
    // it maps moveX onto aim when movement is disabled). Up/down = power.
    it.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    it.powerDelta += (up ? 1 : 0) - (down ? 1 : 0);

    // Gamepad overlay.
    if (s.padIndex >= 0) {
      const pad = this.scene.input.gamepad?.getPad(s.padIndex);
      if (pad) {
        const lx = pad.leftStick.x;
        const ry = -pad.rightStick.y;
        if (Math.abs(lx) > 0.2) it.moveX = lx;
        if (Math.abs(ry) > 0.2) it.powerDelta = ry;
        if (Math.abs(pad.rightStick.x) > 0.2) it.aimDelta = -pad.rightStick.x;
        fire ||= pad.A || pad.R2 > 0.5;
        cycle ||= pad.R1 > 0.5;
        cycleBack ||= pad.L1 > 0.5;
        jump ||= pad.B;
      }
    }

    it.fireHeld = fire;
    it.fire = fire && !s.prevFire;
    it.jump = jump && !s.prevJump;
    if (cycle && !s.prevCycle) it.cycleWeapon = 1;
    else if (cycleBack && !s.prevCycleBack) it.cycleWeapon = -1;
    s.prevFire = fire;
    s.prevCycle = cycle;
    s.prevCycleBack = cycleBack;
    s.prevJump = jump;
    return it;
  }
}
