import Phaser from 'phaser';
import { PAL, hex } from '../../core/palette';
import { queueAtlas, queuePacked, splitPacked, type PackedManifest } from '../atlas';
import { ensureCommonTextures } from '../sprites';
import { NATIVE_H, NATIVE_W } from '../config';
import { queueMusic, type MusicManifest } from '../music';

/**
 * Loads the sprite atlas (two-stage: manifest + names first, then images),
 * builds the procedural textures, and hands over to the menu.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const g = this.add.graphics();
    g.fillStyle(PAL.uiInk, 1).fillRect(0, 0, NATIVE_W, NATIVE_H);
    const label = this.add.text(NATIVE_W / 2, NATIVE_H / 2, 'LOADING ARMOURY', { fontFamily: 'monospace', fontSize: '10px', color: hex(PAL.uiEdge) }).setOrigin(0.5);
    const bar = this.add.graphics();
    this.load.on('progress', (p: number) => {
      bar.clear();
      bar.fillStyle(PAL.uiPanel, 1).fillRect(NATIVE_W / 2 - 80, NATIVE_H / 2 + 14, 160, 6);
      bar.fillStyle(PAL.uiEdge, 1).fillRect(NATIVE_W / 2 - 79, NATIVE_H / 2 + 15, Math.round(158 * p), 4);
    });
    this.load.on('loaderror', (f: Phaser.Loader.File) => console.warn('missing asset', f.key));

    // Packed sheets are the fast path; the per-sprite atlas is the fallback for a
    // tree that has not run tools/pack_atlas.py yet.
    this.load.json('packed-manifest', 'packed/manifest.json');
    this.load.json('atlas-manifest', 'atlas/manifest.json');
    this.load.json('music-manifest', 'music/manifest.json');
    this.load.once('filecomplete-json-packed-manifest', () => {
      const packed = this.cache.json.get('packed-manifest') as PackedManifest | undefined;
      if (packed?.groups?.length) return; // packed sheets carry their own frame names
      const manifest = this.cache.json.get('atlas-manifest') as { sheets: string[] } | undefined;
      for (const sheet of manifest?.sheets ?? []) this.load.json(`names-${sheet}`, `atlas/${sheet}/names.json`);
    });
    this.load.once('complete', () => {
      label.setText('LOADING ARMOURY');
    });
  }

  create(): void {
    // Second stage: the manifests are in, so queue the images they name.
    const packed = this.cache.json.get('packed-manifest') as PackedManifest | undefined;
    const manifest = this.cache.json.get('atlas-manifest') as { sheets: string[] } | undefined;
    const names: Record<string, Record<string, string>> = {};
    if (packed?.groups?.length) {
      queuePacked(this, packed);
    } else if (manifest) {
      for (const sheet of manifest.sheets) {
        const n = this.cache.json.get(`names-${sheet}`) as Record<string, string> | undefined;
        if (n) names[sheet] = n;
      }
      queueAtlas(this, manifest, names);
    }
    const music = this.cache.json.get('music-manifest') as MusicManifest | undefined;
    if (music) queueMusic(this, music);
    this.load.image('title', 'art/title.png');
    for (const b of ['dunes', 'mesas', 'crags', 'basin', 'spires']) this.load.image(`bg-${b}`, `art/bg-${b}.png`);
    this.load.image('campaign-map', 'art/campaign-map.png');
    this.load.once('complete', () => {
      if (packed?.groups?.length) splitPacked(this, packed);
      ensureCommonTextures(this);
      this.scene.start('menu');
    });
    this.load.start();
  }
}
