import Phaser from 'phaser';
import { PAL, hex } from '../../core/palette';
import { queueAtlas, queuePacked, splitPacked, type PackedManifest } from '../atlas';
import { ensureCommonTextures } from '../sprites';
import { NATIVE_H, NATIVE_W } from '../config';
import { queueMusic, type MusicManifest } from '../music';

/**
 * Loads the sprite atlas and hands over to the menu.
 *
 * Two asset layouts are supported: `public/packed` (one sheet plus a frame JSON
 * per group — what the build ships) and `public/atlas` (one PNG per sprite — the
 * fallback for a tree where tools/pack_atlas.py has not been run). The packed
 * manifest is fetched first and decides which path is taken, so the build never
 * requests files it has pruned.
 */
export class BootScene extends Phaser.Scene {
  private label!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Graphics;
  private packed: PackedManifest | null = null;
  /** Set once assets are in; the menu starts from update() — see onAssetsLoaded(). */
  private ready = false;

  constructor() {
    super('boot');
  }

  preload(): void {
    this.add.graphics().fillStyle(PAL.uiInk, 1).fillRect(0, 0, NATIVE_W, NATIVE_H);
    this.label = this.add
      .text(NATIVE_W / 2, NATIVE_H / 2, 'LOADING ARMOURY', { fontFamily: 'monospace', fontSize: '20px', color: hex(PAL.uiEdge) })
      .setOrigin(0.5);
    this.bar = this.add.graphics();
    this.load.on('progress', (p: number) => {
      this.bar.clear();
      this.bar.fillStyle(PAL.uiPanel, 1).fillRect(NATIVE_W / 2 - 160, NATIVE_H / 2 + 28, 320, 12);
      this.bar.fillStyle(PAL.uiEdge, 1).fillRect(NATIVE_W / 2 - 158, NATIVE_H / 2 + 30, Math.round(316 * p), 8);
    });
    this.load.on('loaderror', (f: Phaser.Loader.File) => console.warn('asset failed to load:', f.key, f.src));

    this.load.json('packed-manifest', 'packed/manifest.json');
    this.load.json('music-manifest', 'music/manifest.json');
  }

  create(): void {
    const packed = this.cache.json.get('packed-manifest') as PackedManifest | undefined;
    if (packed?.groups?.length) {
      this.packed = packed;
      queuePacked(this, packed);
      this.queueRest();
      this.load.once('complete', () => this.onAssetsLoaded());
      this.load.start();
      return;
    }
    // Fallback: the per-sprite atlas needs its manifest, then the name maps,
    // then the images — three passes.
    this.load.json('atlas-manifest', 'atlas/manifest.json');
    this.load.once('complete', () => {
      const manifest = this.cache.json.get('atlas-manifest') as { sheets: string[] } | undefined;
      for (const sheet of manifest?.sheets ?? []) this.load.json(`names-${sheet}`, `atlas/${sheet}/names.json`);
      this.load.once('complete', () => {
        const names: Record<string, Record<string, string>> = {};
        for (const sheet of manifest?.sheets ?? []) {
          const n = this.cache.json.get(`names-${sheet}`) as Record<string, string> | undefined;
          if (n) names[sheet] = n;
        }
        if (manifest) queueAtlas(this, manifest, names);
        this.queueRest();
        this.load.once('complete', () => this.onAssetsLoaded());
        this.load.start();
      });
      this.load.start();
    });
    this.load.start();
  }

  /** Whole-image art and music, needed on both paths. */
  private queueRest(): void {
    const music = this.cache.json.get('music-manifest') as MusicManifest | undefined;
    if (music) queueMusic(this, music);
    this.load.image('title', 'art/title.png');
    this.load.image('campaign-map', 'art/campaign-map.png');
    for (const b of ['dunes', 'mesas', 'crags', 'basin', 'spires']) this.load.image(`bg-${b}`, `art/bg-${b}.png`);
  }

  private onAssetsLoaded(): void {
    if (this.packed) splitPacked(this, this.packed);
    ensureCommonTextures(this);
    // Starting a scene from inside a loader callback can leave the target scene
    // stuck in INIT, because the scene manager is mid-processing; flag it and
    // start from update() on a clean frame instead.
    this.ready = true;
    this.label.setText('READY');
  }

  override update(): void {
    if (!this.ready) return;
    this.ready = false;
    this.scene.start('menu');
  }
}
