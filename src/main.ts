import Phaser from 'phaser';
import { NATIVE_H, NATIVE_W, ZOOM } from './render/config';
import { BootScene } from './render/scenes/BootScene';
import { MenuScene } from './render/scenes/MenuScene';
import { BattleScene } from './render/scenes/BattleScene';
import { ShopScene } from './render/scenes/ShopScene';
import { CampaignMapScene } from './render/scenes/CampaignMapScene';
import { CommanderScene } from './render/scenes/CommanderScene';
import { CharacterSelectScene } from './render/scenes/CharacterSelectScene';
import { touchActive } from './render/settings';

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
  // Three pointers: a thumb on a drive pad, another aiming or firing, one spare.
  input: { gamepad: true, activePointers: 3 },
  // In dev the preview pane is often unfocused and throttles requestAnimationFrame
  // to a crawl; a timer-driven loop keeps the simulation and smoke tests running.
  fps: import.meta.env.DEV ? { forceSetTimeOut: true, target: 60 } : undefined,
  scene: [BootScene, MenuScene, BattleScene, ShopScene, CampaignMapScene, CommanderScene, CharacterSelectScene],
});

// Exposed for debugging and automated smoke tests.
(window as unknown as { __game: Phaser.Game }).__game = game;

// ---- touch devices: landscape only, and fullscreen on the first tap ----------
// The layout is 16:9 and the pads sit in the bottom corners; in portrait the
// battlefield is a strip a thumb covers. The overlay asks for a turn rather than
// attempting a portrait layout.
const rotate = document.getElementById('rotate');
function checkOrientation(): void {
  if (!rotate) return;
  const portrait = window.innerHeight > window.innerWidth;
  rotate.style.display = touchActive() && portrait ? 'flex' : 'none';
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);
checkOrientation();

// Fullscreen needs a user gesture, and orientation lock only works in fullscreen
// (and only on Android — iOS Safari has neither). Both are best-effort. It runs on
// pointerUP, not down: going fullscreen reflows the canvas, and doing that in the
// middle of the very first tap moved the button out from under the finger.
let fullscreenTried = false;
game.canvas.addEventListener('pointerup', () => {
  if (fullscreenTried || !touchActive()) return;
  fullscreenTried = true;
  try {
    if (!game.scale.isFullscreen) game.scale.startFullscreen();
  } catch { /* not allowed here; the F key and the page link remain */ }
  const so = (screen as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
  so?.lock?.('landscape').catch(() => { /* unsupported or not fullscreen */ });
}, { passive: true });
