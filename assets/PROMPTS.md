# TANKWARS — asset sheets to generate

Every sheet is generated with an image model (ChatGPT / Gemini / Midjourney), saved at the
**largest resolution the tool offers** (landscape, ≥1536 px wide, PNG), and dropped into
`assets/raw/` with the file name given below. `tools/extract_sheets.py` then segments,
crispens, chroma-keys and names every sprite into `assets/atlas/`.

Nothing here is hand-cut. If a sheet comes out wrong, regenerate it — don't fix it in an
editor.

---

## The preamble — paste at the top of EVERY prompt

> 16-bit pixel art sprite sheet, side view, strict pixel grid: every visible pixel block is
> exactly 4×4 image pixels, hard edges, absolutely no anti-aliasing, no blur, no soft
> gradients. Background is one flat solid magenta #FF00FF everywhere — no shadows under
> objects, no vignette, no frame, no texture. No text, no labels, no captions, no grid
> lines, no watermark. Objects are separated by at least 60 pixels of empty magenta and
> never touch each other or the image edge. Consistent lighting from the upper left.
> Limited palette, at most 32 colours, warm desert sunset scheme: sky #2a0a18 #6d1220
> #b62a19 #e4581a #f5a623, sand #e0a53c #bf7c26 #8f5418 #5a3110 #3b1f0b, steel #d8e4d0
> #8fa08a #4e5a4c #22271f, fire #fff6c8 #ffcb3d #f4691c #a8201a, glow #d9ffe0 #54f08a
> #14804a. Style reference: Metal Slug, Advance Wars, Tank Wars redrawn for a modern
> 1080p display.

Then the sheet-specific block.

Rules of thumb that make my extraction reliable:
- One category per sheet. Never mix tanks with explosions.
- Same scale for everything on a sheet. State a measurement ("hull is 220 px long").
- Facing **right only**. I mirror in code.
- Hulls, turrets and barrels are **separate parts** so turrets rotate and barrels recoil.
- Animations: frames in a single row, left to right, equal spacing, same size.

---

## Sheet 1 — `player-hulls.png`
Six tank hulls **without turret**, facing right, one row, each hull 220 px long
(the scout may be shorter). Include tracks, wheels, fenders, exhaust, lamps, tow hooks,
spare track links. Team colour: neutral **grey-green steel** (I recolour per team), with
accent trims in pure #00FF00 that I remap to team colour.

Order left → right, with a flat turret-ring plate on top where the turret sits:
1. **Line** — classic medium tank, six road wheels.
2. **Scout** — small, four wheels, low profile, wire antenna.
3. **Bulwark** — heavy, seven wheels, appliqué side plates, twin exhausts.
4. **Battery** — self-propelled gun hull, recoil spade at the rear.
5. **Aegis** — hover hull, no tracks, three thruster pods underneath glowing #54f08a.
6. **Strider** — four-legged walker hull, mechanical legs.

## Sheet 2 — `player-turrets.png`
Six turrets **without barrel**, facing right, same order and scale as Sheet 1. Each turret
has a short mantlet stub on its right side where the barrel attaches. Include cupola,
hatch, rivets, optics. Same neutral grey-green with #00FF00 accents.

## Sheet 3 — `barrels.png`
Eight gun barrels, **horizontal, pointing right**, breech end on the left, one row, each
drawn at the scale of Sheet 1 (line tank barrel ≈ 110 px long, 14 px thick):
1. light autocannon, 2. standard, 3. heavy with muzzle brake, 4. long artillery with
thermal sleeve, 5. railgun (two rails, glow #54f08a), 6. missile pod (four tubes),
7. plasma emitter (rings, glow), 8. mortar (short, thick).

## Sheet 4 — `enemy-hulls.png` and Sheet 5 — `enemy-turrets.png`
Same split as Sheets 1–2, five campaign enemies in **rust-red and black** with red glow
#ff2a1a eyes/lamps: **Light**, **Medium**, **Heavy**, **Missile** (turret is a rocket
rack), **Flame** (turret has a fuel drum and nozzle).

## Sheet 6 — `bosses.png`  (one sheet per boss: `boss-behemoth.png`, `boss-juggernaut.png`, `boss-hive.png`)
One boss per sheet, facing right, 900 px long, body **without its guns**, plus its guns
as separate parts to the right, plus a **damaged version** of the body below (cracked
plates, fires, exposed innards). Mark each weapon mount point with a 12 px pure #00FFFF
dot on the body.
- **Iron Behemoth** — black steel, red eyes, spiked track guards, four gun mounts.
- **Desert Juggernaut** — sand-coloured, quad main guns, drill prow, three mounts.
- **Hive Crawler** — insectoid multi-legged, launches drones (include one drone sprite).

## Sheet 7 — `projectiles.png`
Fourteen projectiles, **horizontal, pointing right**, one row, each ≈ 48 px long unless
noted: standard shell, heavy shell (60 px), sabot dart (thin), cluster bomb (round,
fins), bomblet (16 px), hill roller (spiked ball), digger (drill tip), napalm pod
(orange), MIRV (three-warhead nose), railgun slug (glowing rod), airburst frag, earthmover
(blunt cylinder), thermobaric, nuke (90 px, warning stripes).

## Sheet 8 — `fx-explosions.png`
Four rows, each an explosion animation of **10 frames left → right**, frame size 192 px:
row 1 small, row 2 medium, row 3 large, row 4 nuclear (mushroom column, 320 px frames).
Frame 1 is a pinpoint flash; the last frame is thin dispersing smoke.

## Sheet 9 — `fx-misc.png`
Rows of animations, 8 frames each, 128 px frames:
1. muzzle flash (pointing right), 2. smoke puff rising, 3. dust cloud, 4. napalm burning
loop (must loop), 5. shield-hit ripple (green #54f08a hex pattern), 6. sparks burst,
7. shell impact on steel (no fire), 8. crate parachute swaying (4 frames).

## Sheet 10 — `pickups.png`
One row, 96 px objects: wooden crate, metal crate, ammo crate (with #00FF00 stencil),
repair kit (wrench), shield cell, credits chest, weapon crate (rocket stencil), land
mine, fuel barrel, explosive barrel; then the **open parachute** alone (160 px).

## Sheet 11 — `terrain-tiles.png`
Seamless **128×128** tiles, one row, each must tile with itself: light sand surface, sand,
dark packed earth, bedrock, scorched earth, salt crust (white-grey), volcanic ash
(grey-black), cracked clay. Then a second row of **surface decorations** on magenta:
grass tufts ×3, small rocks ×3, bones, cactus tall, cactus short, dead shrub.

## Sheet 12 — backdrops (one file per biome: `bg-dunes.png`, `bg-mesas.png`, `bg-crags.png`, `bg-basin.png`, `bg-spires.png`)
**Not a sprite sheet** — a 16:9 painted pixel-art vista with NO ground in the lower third
(leave the lower third flat magenta). Three separately layered elements stacked
vertically in the same image so I can cut parallax layers: top half = sky with sun/stars/
cloud; middle band = far mountains/mesas on magenta; lower band = near mesas/rock
formations on magenta. Biomes: rolling dunes at sunset, red mesas, black iron crags,
white salt basin at dawn, volcanic ash spires under a dark red sky.

## Sheet 13 — `ui.png`
Riveted steel UI kit on magenta: 9-slice panel (with clear 32 px corner regions),
button normal/hover/pressed, small panel, HP bar frame + fill segments, wind gauge
arrow, weapon slot frame, cursor, checkbox, slider knob, tab. Then **15 weapon icons at
64×64** in the order of Sheet 7 plus crates/repair/shield icons.

## Sheet 14 — `portraits.png`
Nine **160×160 pixel-art portraits**, one row: six player commanders (varied, goggles,
scarves, helmets, no text) and three boss commanders (menacing, matching Sheet 6). Neutral
dark background behind each face **inside a 160×160 frame**, magenta between frames.

## Sheet 15 — `title.png` and `campaign-map.png`
- `title.png`: 16:9 hero illustration for the menu — a colossal boss tank looming over a
  desert plain, three small player tanks racing toward it, blazing sunset. No text.
- `campaign-map.png`: 16:9 top-down stylised desert map with a winding route of 12
  numbered-free node markers (plain circles), three distinct biome regions, a fortress at
  the end. No text.

---

## Naming and dropping in
`assets/raw/<name>.png` exactly as above. Run `py -3 tools/extract_sheets.py` — it writes
`assets/atlas/*.png` + `assets/atlas/atlas.json` and prints anything it could not
segment cleanly (touching sprites, stray labels) so you know what to regenerate.
