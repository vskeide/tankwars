/**
 * Fixed 16-bit-era palette. Every colour in the game comes from here so the
 * procedurally generated sprites, the terrain and the effects stay coherent.
 * Values are 0xRRGGBB. Named after the role, not the hue, so a reskin is one edit.
 */
export const PAL = {
  // Sky — hot desert sunset, dark at the top, blazing at the horizon
  skyTop: 0x2a0a18,
  skyHigh: 0x6d1220,
  skyMid: 0xb62a19,
  skyLow: 0xe4581a,
  skyHorizon: 0xf5a623,

  sunCore: 0xffe9a8,
  sunGlow: 0xf7861b,

  // Distant parallax mesas
  farRock: 0x51121f,
  midRock: 0x7a1f22,
  nearRock: 0x9c3320,

  // Ground layers, top to bottom
  dirtLit: 0xe0a53c,
  dirt: 0xbf7c26,
  dirtDark: 0x8f5418,
  bedrock: 0x5a3110,
  bedrockDark: 0x3b1f0b,

  // Tank chassis ramps (team colours are recoloured from ramp index)
  steelLit: 0xd8e4d0,
  steel: 0x8fa08a,
  steelDark: 0x4e5a4c,
  steelBlack: 0x22271f,

  // Energy / muzzle / thruster glow
  glowCore: 0xd9ffe0,
  glow: 0x54f08a,
  glowDeep: 0x14804a,

  // Fire and explosions
  fireCore: 0xfff6c8,
  fireHot: 0xffcb3d,
  fireMid: 0xf4691c,
  fireDeep: 0xa8201a,
  smoke: 0x4a3a38,
  smokeLight: 0x7d6a63,

  // UI chrome
  uiInk: 0x0d0709,
  uiPanel: 0x1c1116,
  uiPanelLit: 0x2e1c22,
  uiEdge: 0xf5a623,
  uiText: 0xffe9c4,
  uiTextDim: 0xa4826a,
  uiDanger: 0xff4d3d,
  uiGood: 0x54f08a,
} as const;

export type PaletteKey = keyof typeof PAL;

/** Team colours, used to recolour the tank chassis ramp. */
export const TEAM_COLOURS = [
  { name: 'Verdigris', lit: 0x7fe0a0, mid: 0x2f9c5e, dark: 0x144a2c },
  { name: 'Ember', lit: 0xffb066, mid: 0xd9591c, dark: 0x6e230a },
  { name: 'Cobalt', lit: 0x8ac6ff, mid: 0x2f6bd4, dark: 0x14306e },
  { name: 'Bone', lit: 0xfff0d4, mid: 0xc2a37a, dark: 0x5f4a2e },
  { name: 'Violet', lit: 0xd7a0ff, mid: 0x8a3fd4, dark: 0x3d1470 },
  { name: 'Rust', lit: 0xff8e8e, mid: 0xc23a3a, dark: 0x5e1414 },
] as const;

export function hex(colour: number): string {
  return '#' + colour.toString(16).padStart(6, '0');
}
