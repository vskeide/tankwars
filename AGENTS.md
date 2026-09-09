# TANKWARS — agent instructions

Turn-based and real-time artillery game in the spirit of Tank Wars (DOS, 1991) with
modern pixel art, tank classes, a fifteen-weapon armoury, hotseat play and a campaign
with bosses. Phaser 3 + TypeScript + Vite. Runs in the browser at 1920×1080 native (the
world, terrain, particles and text are per-pixel); sheet sprites are drawn at an integer
`SPRITE_SCALE` of 2. Balance numbers (radii, speeds, hitboxes) are authored in design
units and multiplied by `UNIT = 2` from `core/physics.ts`.

## The one architectural rule

**`src/core/` is pure TypeScript.** No Phaser, no DOM, no `window`, no `document`. It
holds the terrain, physics, weapons, tank classes, the World simulation, the rules
layers and the bot AI. It must run headless (tests, replays, a future Godot/Three.js
port). If you need a browser API in core, you are in the wrong layer.

`src/render/` is Phaser-specific: scenes, sprites, effects, audio, input routing, HUD.

## Testing

`npm test` runs the vitest suites in `tests/` (core only — ballistics, terrain collapse,
damage falloff, bot solver, hazards, campaign scripting, save round-trip). Fixtures in
`tests/helpers.ts` build flat maps by hand rather than through `Terrain.generate`, so
assertions do not depend on a generated silhouette. `npm run typecheck` covers `src` and
`tests`. `tools/smoke.ts` remains the full-match headless smoke run.

Anything in `src/core/` is testable this way and should have a test when it encodes a
rule. `src/render/` is not covered: verify it in the browser.

## Layout

| Path | What |
|---|---|
| `src/core/world.ts` | The simulation: terrain, tanks, projectiles, crates, boss hardpoints, fixed-step `step()` and a `WorldEvent` queue for the renderer |
| `src/core/rules/turnBased.ts` | Classic / Modern / Advanced: one tank acts, world settles, turn passes; shop between rounds. Also the `'placing'` phase (players drop their own tanks; drop order is turn order) and per-tank `MatchStats` |
| `src/core/shop.ts` | Armoury spend rules (weapons, Reinforced Hull), shared by the turn-based and campaign shops |
| `src/core/save.ts` | Save/restore an in-progress turn-based match; terrain is run-length encoded per column |
| `src/core/rules/arena.ts` | Real-time hotseat: all tanks act every frame, cooldowns, crate drops |
| `src/core/rules/campaign.ts` | Scripted levels, enemy waves, bosses with hardpoints/phases; commander perks, difficulty tiers, per-level score tallies |
| `src/core/campaign/` | Levels, bosses, generated mounts, map nodes, commanders, difficulty, score formula |
| `src/render/campaignRun.ts` | localStorage persistence of the run, progress, high scores and the between-mission `Loadout` |
| `src/render/savedMatch.ts` | localStorage slot for the saved turn-based match (F2 in battle, CONTINUE in the menu) |
| `src/render/shopHost.ts` | What `ShopScene` needs from whoever opened it, so the same UI serves the match shop and the campaign armoury |
| `src/render/screenFx.ts` | Camera post-FX: nuke flash, napalm heat haze, low-HP vignette. Added and removed on demand |
| `src/core/modes.ts` | The three turn-based modes as data. Add a mode here, not in code |
| `src/core/weapons.ts`, `tanks.ts` | The armoury and hull roster. Each entry lists which modes it exists in |
| `src/core/terrain.ts` | Destructible byte-map with dirty-rect tracking; midpoint-displacement generator; six terrain styles |
| `src/core/physics.ts` | Ballistics step + headless `simulateFlight()` (used by AI and aim assist) |
| `src/core/ai.ts` | `BotController` — emits `Intent`s like a human; solves shots by simulating on the real terrain |
| `src/core/input.ts` | `Intent` (one frame of player input) and the four hotseat `KeySet`s |
| `src/render/scenes/` | Boot (atlas load), Menu, CharacterSelect, Battle (all three rules layers), Shop, CampaignMap, Commander |
| `src/render/atlas.ts` | Loads `public/atlas/<sheet>/NN.png` by `names.json`; derives barrel-less, team-recoloured hulls |
| `src/render/sprites.ts` | Procedural pixel-art fallback hulls (used when a class has no sheet sprite) |
| `src/render/backdrop.ts` | Procedural dithered sky, sun, parallax mesas |
| `src/render/terrainView.ts` | Terrain byte-map → canvas texture, dirty band only |
| `src/render/audio.ts` | sfxr-style synthesised sound effects, no sample files |
| `tools/extract_sheets.py` | Segments AI-generated sprite sheets in `assets/raw/` into `public/atlas/` |
| `tools/pack_atlas.py` | Packs `public/atlas/` into one sheet + frame JSON per group in `public/packed/` — **run after every extraction**; the game loads these and splits them back into per-id textures at boot |
| `assets/PROMPTS.md` | Every sheet to generate, with file name and prompt |

## Assets

Sprite sheets are generated with an image model from the prompts in `assets/PROMPTS.md`
and dropped in `assets/raw/`. `py -3 tools/extract_sheets.py` produces
`public/atlas/<sheet>/NN.png` + `sheet.json`; a hand-written `names.json` per sheet maps
index → sprite id (`tank.assault.r`, `fx.explosion.medium.3`, …). Add the sheet to
`public/atlas/manifest.json`. Code asks `atlasHas(id)` and falls back to procedural art.

Never hand-edit an extracted sprite; regenerate the sheet instead.

## Conventions

- Angles: degrees from +X, counter-clockwise (0 right, 90 up, 180 left). Power 5–100.
- World coordinates are terrain pixels with y down; the renderer offsets by `HUD_H`.
- `ZOOM`/`SPRITE_SCALE` in `render/config.ts` and `UNIT` in `core/physics.ts` are the only
  places scale lives. Never hardcode a pixel count that depends on resolution.
- Deterministic: `Rng` everywhere in core, seeded from the match seed. `Math.random` is
  allowed in the render layer and inside bot noise only.
- Commit messages: imperative subject, body says why.

## Running

```bash
npm run dev        # vite on :5180
npm run typecheck
npm run build
```

`window.__game` is exposed for smoke tests: `__game.scene.start('battle', setup)`.

## Roadmap (in order)

1. Turn-based Classic/Modern/Advanced + Arena playable ✔
2. Campaign: levels, enemy waves, two bosses with hardpoints and phases ✔ (needs play-tuning)
3. Separate hull/turret/barrel sheets → true turret rotation & recoil
4. Arena: jump/hop hulls, mines, stationary defences
5. Gamepad polish; more settings (tank size ✔ — `render/settings.ts`), persistence ✔
   Consider: hold-to-charge as an option in turn-based modes; turret tilt on slopes
6. **Music (TODO, needs Vebjørn):** generate Mad-Max-flavoured tracks in Suno (menu, 2–3 battle,
   boss), drop them in `public/music/` and list them in `music/manifest.json`. The player
   (`render/music.ts`) is done; nothing plays until files exist.
