import Phaser from 'phaser';
import { NATIVE_H, NATIVE_W, ZOOM } from './render/config';
import { BootScene } from './render/scenes/BootScene';
import { MenuScene } from './render/scenes/MenuScene';
import { BattleScene } from './render/scenes/BattleScene';
import { ShopScene } from './render/scenes/ShopScene';
import { CampaignMapScene } from './render/scenes/CampaignMapScene';
import { CommanderScene } from './render/scenes/CommanderScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: NATIVE_W,
  height: NATIVE_H,
  zoom: ZOOM,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#12070c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { gamepad: true },
  // In dev the preview pane is often unfocused and throttles requestAnimationFrame
  // to a crawl; a timer-driven loop keeps the simulation and smoke tests running.
  fps: import.meta.env.DEV ? { forceSetTimeOut: true, target: 60 } : undefined,
  scene: [BootScene, MenuScene, BattleScene, ShopScene, CampaignMapScene, CommanderScene],
});

// Exposed for debugging and automated smoke tests.
(window as unknown as { __game: Phaser.Game }).__game = game;
