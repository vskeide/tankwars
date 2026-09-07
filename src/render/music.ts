/**
 * Background music. Tracks are external files (Suno or similar) listed in
 * public/music/manifest.json:
 *
 *   { "menu": ["menu-1.mp3"], "battle": ["battle-1.mp3", "battle-2.mp3"], "boss": ["boss-1.mp3"] }
 *
 * Anything missing is skipped silently. `N` toggles music in-game.
 */
import Phaser from 'phaser';

export interface MusicManifest {
  menu?: string[];
  battle?: string[];
  boss?: string[];
}

const KEY_PREFIX = 'music:';
let manifest: MusicManifest = {};
let current: Phaser.Sound.BaseSound | null = null;
let currentGroup: keyof MusicManifest | null = null;
let muted = false;
try {
  muted = localStorage.getItem('tankwars.music') === 'off';
} catch { /* private mode */ }

/** Queue every listed file in the loader. Call from a preload() with the manifest already loaded. */
export function queueMusic(scene: Phaser.Scene, m: MusicManifest): void {
  manifest = m;
  for (const group of ['menu', 'battle', 'boss'] as const) {
    for (const f of m[group] ?? []) {
      if (!scene.cache.audio.exists(KEY_PREFIX + f)) scene.load.audio(KEY_PREFIX + f, `music/${f}`);
    }
  }
}

/** Play a random track from the group, unless that group is already playing. */
export function playMusic(scene: Phaser.Scene, group: keyof MusicManifest): void {
  const list = (manifest[group] ?? []).filter((f) => scene.cache.audio.exists(KEY_PREFIX + f));
  if (!list.length) return;
  if (currentGroup === group && current && current.isPlaying) return;
  stopMusic(scene);
  const file = list[Math.floor(Math.random() * list.length)];
  current = scene.sound.add(KEY_PREFIX + file, { loop: list.length === 1, volume: 0 });
  currentGroup = group;
  if (!muted) {
    current.play();
    scene.tweens.add({ targets: current, volume: 0.45, duration: 1500 });
    if (list.length > 1) current.once('complete', () => { current = null; currentGroup = null; playMusic(scene, group); });
  }
}

export function stopMusic(scene: Phaser.Scene): void {
  if (!current) return;
  const s = current;
  scene.tweens.add({ targets: s, volume: 0, duration: 600, onComplete: () => s.stop() });
  current = null;
  currentGroup = null;
}

export function toggleMusic(scene: Phaser.Scene): boolean {
  muted = !muted;
  try {
    localStorage.setItem('tankwars.music', muted ? 'off' : 'on');
  } catch { /* private mode */ }
  if (muted) stopMusic(scene);
  else if (currentGroup) {
    const g = currentGroup;
    currentGroup = null;
    playMusic(scene, g);
  }
  return !muted;
}

export function musicOn(): boolean {
  return !muted;
}
