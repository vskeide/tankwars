/**
 * A tappable button: rounded panel, label, and a hit zone. Used by every menu
 * that used to be keyboard-only, so a finger (or a mouse) can drive the game.
 *
 * Buttons are built in whatever coordinate space the calling scene lays out in
 * (the 640-wide menu grid, or native 1920), so sizes are the caller's problem.
 */
import Phaser from 'phaser';
import { PAL, hex } from '../core/palette';

export interface ButtonOptions {
  fontSize?: string;
  depth?: number;
  /** Pin to the camera (HUD buttons in the battle scene). */
  fixed?: boolean;
  /** Accent colour for the border and label. */
  colour?: number;
  /** Fill alpha, for overlays that should read as translucent. */
  alpha?: number;
  /** Text resolution multiplier, for scenes that lay out on a zoomed grid. */
  resolution?: number;
}

export interface Button {
  readonly zone: Phaser.GameObjects.Zone;
  readonly bg: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  setLabel(text: string): void;
  setEnabled(enabled: boolean): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onTap: () => void,
  opts: ButtonOptions = {},
): Button {
  const depth = opts.depth ?? 50;
  const colour = opts.colour ?? PAL.uiEdge;
  const alpha = opts.alpha ?? 0.9;
  const bg = scene.add.graphics().setDepth(depth);
  const label = scene.add
    .text(x + w / 2, y + h / 2, text, { fontFamily: 'monospace', fontSize: opts.fontSize ?? '16px', color: hex(colour), align: 'center' })
    .setOrigin(0.5)
    .setDepth(depth + 1);
  if (opts.resolution) label.setResolution(opts.resolution);
  const zone = scene.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
  zone.setDepth(depth + 2);
  if (opts.fixed) {
    bg.setScrollFactor(0);
    label.setScrollFactor(0);
    zone.setScrollFactor(0);
  }

  let enabled = true;
  let pressed = false;
  const paint = () => {
    bg.clear();
    bg.fillStyle(PAL.uiInk, alpha).fillRoundedRect(x, y, w, h, Math.min(8, h / 4));
    bg.lineStyle(pressed ? 3 : 2, colour, enabled ? 1 : 0.35).strokeRoundedRect(x, y, w, h, Math.min(8, h / 4));
    if (pressed) bg.fillStyle(colour, 0.18).fillRoundedRect(x, y, w, h, Math.min(8, h / 4));
    label.setAlpha(enabled ? 1 : 0.4);
  };
  paint();

  zone.on('pointerdown', () => {
    if (!enabled) return;
    pressed = true;
    paint();
  });
  zone.on('pointerup', () => {
    if (!enabled || !pressed) return;
    pressed = false;
    paint();
    onTap();
  });
  zone.on('pointerout', () => {
    if (!pressed) return;
    pressed = false;
    paint();
  });

  return {
    zone,
    bg,
    label,
    setLabel: (t) => label.setText(t),
    setEnabled: (e) => {
      enabled = e;
      paint();
    },
    setVisible: (v) => {
      bg.setVisible(v);
      label.setVisible(v);
      zone.setVisible(v);
      if (v && enabled) zone.setInteractive();
      else zone.disableInteractive();
    },
    destroy: () => {
      zone.destroy();
      bg.destroy();
      label.destroy();
    },
  };
}
