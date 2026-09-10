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

// ---- fullscreen: one button, every screen ------------------------------------
// The F key exists only in battle and only on a keyboard; on a phone this button
// is the way in and out, and it works on any scene because it lives in the page
// rather than in Phaser. Hidden where the browser cannot do it: iPhone Safari has
// no element fullscreen at all, and the site's "open in its own window" link is
// the fallback there. Orientation lock needs fullscreen and only Android has it.
const fsButton = document.getElementById('fs') as HTMLButtonElement | null;
if (fsButton && game.scale.fullscreen.available) {
  fsButton.style.display = 'block';
  const paint = () => {
    fsButton.textContent = game.scale.isFullscreen ? '⤡' : '⛶';
    fsButton.title = game.scale.isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
  };
  fsButton.addEventListener('click', () => {
    if (game.scale.isFullscreen) {
      game.scale.stopFullscreen();
      return;
    }
    game.scale.startFullscreen();
    if (touchActive()) {
      const so = (screen as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      so?.lock?.('landscape').catch(() => { /* unsupported or refused */ });
    }
  });
  game.scale.on(Phaser.Scale.Events.ENTER_FULLSCREEN, paint);
  game.scale.on(Phaser.Scale.Events.LEAVE_FULLSCREEN, paint);
  paint();
}
