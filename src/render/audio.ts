/**
 * Procedural retro sound effects — sfxr-style synthesis straight into WebAudio,
 * no sample files. Each call builds a short buffer from a recipe and plays it.
 */

type Recipe = {
  wave: 'square' | 'saw' | 'noise' | 'sine' | 'tri';
  freq: number;
  /** Frequency multiplier at the end of the sound. */
  slide: number;
  duration: number;
  attack: number;
  decay: number;
  volume: number;
  /** Low-pass cutoff as a fraction of sample rate (0..0.5), 0.5 = off. */
  lp: number;
  /** Vibrato depth / speed for engines. */
  vib?: [number, number];
  /** Distortion drive. */
  drive?: number;
};

const RECIPES: Record<string, Recipe> = {
  fire: { wave: 'noise', freq: 900, slide: 0.15, duration: 0.32, attack: 0.002, decay: 0.3, volume: 0.6, lp: 0.18, drive: 2 },
  fireHeavy: { wave: 'noise', freq: 500, slide: 0.1, duration: 0.5, attack: 0.002, decay: 0.45, volume: 0.75, lp: 0.12, drive: 3 },
  railgun: { wave: 'saw', freq: 1800, slide: 0.05, duration: 0.45, attack: 0.001, decay: 0.4, volume: 0.5, lp: 0.4 },
  explode: { wave: 'noise', freq: 400, slide: 0.05, duration: 0.9, attack: 0.005, decay: 0.85, volume: 0.9, lp: 0.09, drive: 2.5 },
  explodeBig: { wave: 'noise', freq: 220, slide: 0.03, duration: 1.8, attack: 0.01, decay: 1.7, volume: 1, lp: 0.06, drive: 3 },
  explodeSmall: { wave: 'noise', freq: 800, slide: 0.2, duration: 0.35, attack: 0.002, decay: 0.3, volume: 0.55, lp: 0.15 },
  hit: { wave: 'square', freq: 220, slide: 0.4, duration: 0.18, attack: 0.001, decay: 0.16, volume: 0.5, lp: 0.3 },
  shield: { wave: 'sine', freq: 660, slide: 1.6, duration: 0.25, attack: 0.005, decay: 0.2, volume: 0.4, lp: 0.5 },
  kill: { wave: 'saw', freq: 300, slide: 0.15, duration: 0.8, attack: 0.005, decay: 0.75, volume: 0.6, lp: 0.2, drive: 2 },
  aim: { wave: 'square', freq: 1200, slide: 1, duration: 0.03, attack: 0.001, decay: 0.025, volume: 0.12, lp: 0.5 },
  cycle: { wave: 'square', freq: 700, slide: 1.5, duration: 0.07, attack: 0.001, decay: 0.06, volume: 0.25, lp: 0.5 },
  select: { wave: 'square', freq: 520, slide: 2, duration: 0.09, attack: 0.001, decay: 0.08, volume: 0.3, lp: 0.5 },
  back: { wave: 'square', freq: 520, slide: 0.5, duration: 0.09, attack: 0.001, decay: 0.08, volume: 0.3, lp: 0.5 },
  crate: { wave: 'tri', freq: 440, slide: 2.5, duration: 0.3, attack: 0.005, decay: 0.25, volume: 0.4, lp: 0.5 },
  land: { wave: 'noise', freq: 300, slide: 0.5, duration: 0.15, attack: 0.001, decay: 0.13, volume: 0.35, lp: 0.1 },
  split: { wave: 'square', freq: 900, slide: 0.6, duration: 0.12, attack: 0.001, decay: 0.1, volume: 0.35, lp: 0.4 },
  burn: { wave: 'noise', freq: 200, slide: 1, duration: 1.2, attack: 0.05, decay: 1.1, volume: 0.35, lp: 0.05 },
  win: { wave: 'square', freq: 440, slide: 2, duration: 0.6, attack: 0.01, decay: 0.55, volume: 0.4, lp: 0.5, vib: [0.02, 12] },
  drive: { wave: 'saw', freq: 70, slide: 1.2, duration: 0.25, attack: 0.02, decay: 0.2, volume: 0.18, lp: 0.08, vib: [0.05, 30] },
  tick: { wave: 'square', freq: 1500, slide: 1, duration: 0.02, attack: 0.001, decay: 0.015, volume: 0.15, lp: 0.5 },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private cache = new Map<string, AudioBuffer>();
  muted = false;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const AC = window.AudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Browsers need a user gesture before audio; call from the first click/keypress. */
  unlock(): void {
    const c = this.ensure();
    if (c && c.state === 'suspended') void c.resume();
  }

  play(name: string, volume = 1, pitch = 1): void {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const recipe = RECIPES[name];
    if (!recipe) return;
    const key = `${name}:${pitch.toFixed(2)}`;
    let buf = this.cache.get(key);
    if (!buf) {
      buf = synth(ctx, recipe, pitch);
      this.cache.set(key, buf);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }
}

function synth(ctx: AudioContext, r: Recipe, pitch: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * r.duration);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let phase = 0;
  let lpState = 0;
  const alpha = Math.min(1, r.lp * 2);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  let noiseHold = 0;
  let noiseCounter = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = r.freq * pitch * (1 + (r.slide - 1) * t) * (r.vib ? 1 + Math.sin(i / sr * r.vib[1] * Math.PI * 2) * r.vib[0] : 1);
    phase += f / sr;
    if (phase > 1) phase -= 1;
    let s: number;
    switch (r.wave) {
      case 'square': s = phase < 0.5 ? 1 : -1; break;
      case 'saw': s = phase * 2 - 1; break;
      case 'tri': s = 1 - 4 * Math.abs(phase - 0.5); break;
      case 'sine': s = Math.sin(phase * Math.PI * 2); break;
      default: {
        // Sample-and-hold noise so the "frequency" sets its grit.
        const hold = Math.max(1, Math.floor(sr / (f * 2)));
        if (noiseCounter++ >= hold) { noiseHold = rnd() * 2 - 1; noiseCounter = 0; }
        s = noiseHold;
      }
    }
    if (r.drive) s = Math.tanh(s * r.drive);
    // Envelope
    const sec = i / sr;
    let env = sec < r.attack ? sec / r.attack : Math.max(0, 1 - (sec - r.attack) / r.decay);
    env = env * env;
    // One-pole low-pass
    lpState += alpha * (s - lpState);
    d[i] = lpState * env * r.volume;
  }
  return buf;
}
