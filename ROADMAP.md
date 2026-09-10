# TANKWARS — suggested implementations

Prioritised backlog. Effort: S = under an hour, M = an evening, L = several sessions.
Items marked ★ were asked for by Vebjørn; the rest are my suggestions.

## Campaign

| # | Item | Effort | Notes |
|---|---|---|---|
| 1 | ✔ ★ **Choose a commander** before the campaign: six portraits, each tied to a hull class and a small perk (e.g. +fuel, +1 starting weapon, faster reload, tougher armour) | M | Portraits exist (`portrait.p1–p6`); perks reuse `TankPerk`. Selection screen sits before the map |
| 2 | ✔ ★ **Campaign score & high-score table**: time to finish, damage taken, shots fired, accuracy, crates collected, deaths/retries, difficulty multiplier → one score; per-commander and overall best in `localStorage`, shown on the map and on completion | M | Needs a difficulty setting (3) to be meaningful; export/import as JSON so scores survive a browser wipe |
| 3 | ✔ **Campaign difficulty** (Recruit / Soldier / Veteran / Ironman): enemy accuracy, boss HP/tempo, crate rate; Ironman = no retries, run ends on death | S | Score multiplier feeds item 2 |
| 4 | ✔ **Level intro cards** with commander portrait, mission brief and enemy roster; boss taunt lines on phase changes | S | Card is dismissed by the player (SPACE/ENTER/click), not a timer, and lists the roster from `CampaignLevel.roster()`. Boss phases carry a `taunt` line shown on a portrait card; the reveal and taunts wait until the briefing is closed |
| 5 | ✔ **Third boss (Hive Crawler)** in the campaign: legged body, drone launcher, three mounts already detected; drones as small flying hardpoints that dive at the player | M | New `hive` boss (level `b03`, mission 12 of 13) with a `drone` attack kind: the bay launches homing drones that steer at the nearest player and detonate on contact, on timeout, or when shot down. Drones sit outside the boss hardpoint map so shooting them does not advance its phases |
| 6 | ✔ **Stationary defences** on later levels: gun turret and missile launcher sprites from the misc sheet as immobile hardpoints | S | `DEFENCES` in `bosses.ts` reuse the whole boss machinery (hardpoint damage, attack scheduling, HP bars) behind a `quiet` flag so they get no boss card and no boss music. Placed per level via `LevelDef.defences`; they must be destroyed to clear the level |
| 7 | ✔ **Mines and explosive barrels** placed by level scripts; barrels chain-react | S | New `Hazard` entity in `world.ts`: mines trip on tank proximity, barrels detonate when shot and their blast sets off neighbours (queued breadth-first, so a row chains without recursion). Placed via `LevelDef.hazards`; covered by `tests/hazards.test.ts` |
| 8 | ✔ **Between-level shop** in campaign with the credits earned (repairs, ammo), so choices carry between missions | S | `ShopScene` now talks to a `ShopHost` (`shopHost.ts`) rather than a `TurnBasedMatch`, with the shared spend rules in `core/shop.ts`. Open it with **B** on the campaign map; credits, leftover ammo and bought hull persist in a `Loadout` in localStorage and are applied on the next mission |
| 9 | **Story thread**: four or five lines per act (three acts = three biomes on the map), written in Nynorsk and English toggle | S | Content pass, no code beyond a language setting |
| 10 | **Secret/optional nodes** on the map (two unused markers): bonus missions with rare weapons | S | Map has 14 markers, 12 used |

## Gameplay & feel

| # | Item | Effort | Notes |
|---|---|---|---|
| 11 | ✔ **Turret tilts with the hull** on slopes; barrel pivot follows | S | Cosmetic but very visible on dunes |
| 12 | ✔ **Hold-to-charge as an option in turn-based** modes (setting), for players who prefer the Arena feel | S | Setting + `turnIntent` change |
| 13 | **Tank drive animation**: track-link scroll and slight hull bob while moving; dust behind | S | `fx.dust` exists; tracks need a 2-frame offset trick on the hull sprite |
| 14 | **Damage states**: soot/crack overlay at <50 % and <25 % HP, smoke already there | S | Procedural overlay on the hull texture |
| 15 | **Wind gusts** in real-time modes (wind drifts smoothly instead of stepping) and a visible wind sock/particles | S | HUD gauge already animates |
| 16 | **Shot camera**: brief follow-cam on long shots in turn-based (zoom out to show the whole arc, then punch in on impact) | M | Camera already supports zoom; needs a small state machine |
| 17 | ✔ **Replay of the killing shot** at round end, slow-motion | M | Core is deterministic; record the inputs of the last turn and re-simulate |
| 18 | **Weather/time of day** per round: night rounds with tracer glow, sandstorm rounds with reduced visibility and stronger wind | M | Backdrop tint + particle layer + wind range |
| 19 | **More weapons** to round out the 15: guided missile (steer while in flight), teleporter, dirt bomb (buries a target), shield generator drop | M | Behaviours in `world.ts`; sprites needed |
| 20 | **Bot personalities**: aggressive / cautious / crate-hunter, chosen per bot; taunt lines | S | Profiles in `ai.ts` |
| 20a | ✔ ★ **Fix movement getting stuck on rugged terrain** — tanks catch on jagged slope steps instead of climbing/sliding over them | S | `drive()` in `world.ts` now allows a small step-up tolerance (`STEP_ASSIST`) on top of the class climb limit, absorbing the terrain generator's single-pixel jaggies without changing what a real slope blocks |
| 20b | ✔ ★ **Slow down tank driving speed** — still too fast even after the earlier Advanced-mode nerf (180→60 px/s); wants a further global pass | S | Turn-based (Advanced) drive: 60→40 px/s. Real-time (Arena/Campaign) `DRIVE_SPEED`: 170→110 (×`UNIT`, i.e. 340→220 px/s) |
| 20c | ✔ ★ **Nerf the cluster bomb** — currently too strong relative to its cost | S | `cluster` in `weapons.ts`: damage 20→14 (max spread damage 100→70), radius 22→18, ammoPerBuy 4→3, cost 1200→1600 |
| 20i | ✔ ★ **No trajectory preview in Advanced** — the short arc made ranging a shot far too easy | S | `aimAssist: 'off'` for Advanced in `modes.ts`. Classic never had one; Modern keeps it as the training wheel |
| 20j | ✔ ★ **Drop your own tank at the start of a round**, and whoever drops first fires first | M | New `'placing'` phase in `TurnBasedMatch`: each human picks a column in turn (mouse or ←→, ENTER/click to drop), with a minimum gap between tanks and a translucent ghost showing where it lands. Bots auto-place. Drop order *is* the turn order, so the worst-standing tank both drops and fires first. Toggle in the menu (PLACEMENT: DROP YOUR OWN / RANDOM SPOTS) |
| 20d | ✔ ★ **Show a stats screen at match end** (after all rounds), not just per-round: shots fired, hits, accuracy, damage dealt/taken, kills per player | S | New `MatchStats`/`tallyMatchStats()` shared by `TurnBasedMatch` and `ArenaMatch` (same peekEvents pattern as campaign's `LevelStats`); `showResults()` in `BattleScene.ts` renders it per player |

## Terrain

| # | Item | Effort | Notes |
|---|---|---|---|
| 20e | ✔ ★ **More challenging terrain generation** — too few mountains currently; want taller, more varied elevation and tighter chokepoints | S | `buildSurface()` in `terrain.ts`: amplitude 0.42→0.58, slower per-octave decay (more mid-frequency peaks survive smoothing), `minY` 0.16→0.08 (taller peaks reach higher); style roughness bumped up across the board |
| 20f | **Floating islands**: terrain segments detached from the ground, reachable only by flight/jump weapons or as landing spots for lobbed shots | M | Not done — still the biggest terrain change on this list. Terrain is a single heightmap column-per-x; floating islands need either a second terrain layer or a heightmap with holes + separate island colliders |
| 20g | ✔ (partial) ★ **Terrain style picker, Worms-style** — add new styles | S–M | Added a sixth style, Choke Canyon (tight passes, tall walls), reusing Crags art since no new art exists yet. Still name-only cycling in the setup screen, not a visual preview grid — archipelago/floating-islands style depends on 20f |

## Character select

| # | Item | Effort | Notes |
|---|---|---|---|
| 20h | ✔ ★ **Street-Fighter-style character select before battle**, for Arena and Classic/Modern/Advanced too, not just Campaign — grid of the existing portraits/skins, type a name per slot | M | New `CharacterSelectScene` (`charselect`): sequential per-human-slot pick from the six commander portraits + typed name; sets `tankClass`/`colour` to match, clamped to what the mode allows. Bots auto-assigned. Wired in after MenuScene's start for turn/arena; Campaign keeps its existing `CommanderScene` |

## Multiplayer

| # | Item | Effort | Notes |
|---|---|---|---|
| 21 | **Team mode** (2v2) in turn-based and Arena: shared kills, no friendly-fire damage option | S | `owner`/team field on tanks |
| 22 | **Gamepad support end-to-end**: menu navigation, slot assignment screen ("press a button to join"), rumble on hits | M | Input router already maps pads; UI missing |
| 23 | **Online 1v1 via WebRTC** (peer-to-peer, no server): deterministic core makes lockstep feasible — only inputs are exchanged | L | Biggest single item; the architecture was chosen with this in mind |

## Presentation

| # | Item | Effort | Notes |
|---|---|---|---|
| 24 | ★ **Music** from Suno: menu, 2–3 battle, boss | — | Player is done; drop files in `public/music/` |
| 25 | **Sound pass**: per-weapon fire sounds, shell whistle, distinct hit-on-hull vs hit-on-dirt, crate land, UI clicks | S | Synth recipes in `audio.ts`; or Suno/Freesound samples |
| 26 | **UI kit** from the `ui.png` sheet: 9-slice panels, buttons, HP bar frame, wind gauge art | M | Sprites extracted; replace the drawn HUD boxes |
| 27 | ✔ **Weapon icons in the shop** and a weapon preview (blast radius circle on the terrain when selecting) | S | `icon.<id>` sprites down the rack, plus a blast-to-scale panel: the highlighted weapon's crater drawn against a tank silhouette at the same scale, so `radius 38` means something |
| 28 | **Title screen attract mode**: bots play a demo round behind the menu | S | Start a bot-only battle scene underneath the menu |
| 29 | ✔ **Screen effects**: chromatic flash on nukes, heat-haze over napalm, vignette on low HP | S | New `screenFx.ts` on Phaser's built-in post-FX: bloom + brightness/hue sweep for a nuke, a procedurally generated noise texture driving a displacement shimmer while napalm burns, and a mild low-HP vignette. Pipelines are added and removed on demand rather than left on. Kept deliberately subtle — camera post-FX covers the HUD too |
| 30 | **Localisation**: Nynorsk/English toggle for all UI text | M | String table; Nynorsk via the `nynorsk-writing` skill |

## Platform & tooling

| # | Item | Effort | Notes |
|---|---|---|---|
| 31 | ✔ **Static deploy** — built into `my-website/public/games/tankwars`, live at skeide.me/ai/games/tankwars | S | Re-deploy = rebuild, copy `dist/` over, commit the website |
| 31b | ✔ **Pack the atlas into spritesheets** — `tools/pack_atlas.py` writes one sheet + frame JSON per group (19 sheets, 39 requests instead of 340); boot splits frames back into per-id textures | M | Re-run it after every extraction; `public/atlas` stays as the dev fallback |
| 32 | **Desktop build** (Tauri or Electron) for a Steam-like windowed app with fullscreen and gamepad focus | M | Tauri keeps it small |
| 33 | **Settings screen**: volume sliders, tank size, aim speed, key rebinding per slot, colour-blind team palette | M | `settings.ts` exists |
| 34 | ✔ **Save/continue a turn-based match** (serialise World + match state) | S | **F2** during your own aim phase saves; the menu grows a CONTINUE SAVED row. `core/save.ts` snapshots config, tanks and the damaged terrain (run-length encoded per column: a whole match is ~60 KB), and restores the rng state so the match does not diverge after a load. Only the aim phase saves, so projectiles never need serialising. Covered by `tests/save.test.ts` |
| 35 | ✔ **Unit tests for the core** (vitest): ballistics, terrain collapse, damage falloff, bot solver convergence | S | `npm test` — suites in `tests/`, fixtures in `tests/helpers.ts`; `tools/smoke.ts` stays as the full-match smoke run |
| 36 | **Asset pipeline hardening**: `npm run assets` runs extractor + mounts + contact sheets; a check that every id in `names.json` has a file | S | Makes new sheets a one-command drop-in |

## Deploy

The game is served from the website repo (option A): `npm run build` in this repo, copy
`dist/*` into `my-website/public/games/tankwars/`, commit the website. The page at
`app/[locale]/ai/games/tankwars/page.tsx` embeds it in an iframe; `vite.config.ts` uses
`base: './'` so it works from that sub-path.

## Done tonight (2026-09-08/09)

1, 2, 3 (commander, score, difficulty), 11 (hull tilt), 12 (hold-to-charge option), 17 (killing-shot
replay). Follow-ups noted while building them:

- Score export/import as JSON (item 2's note) — not done; scores live only in this browser.
- Commander perks for the co-op second player — currently only P1 gets the perk.
- Hardpoint hit detection counts any damage as a "hit" for accuracy; splash on two targets counts twice.
- Replay is turn-based only; Arena/Campaign kills have no replay.
- Turret still does not pitch with the hull's tilt (barrel stays absolute — correct for aim, slightly stiff visually).

## Done 2026-09-09

Replaced the between-round repair with **Reinforced Hull**: +10 bonus HP per 100 credits, capped
at +100 bonus (100/100 base -> up to 200/200). Not a permanent max-HP raise — the class base
always heals fully each round, but the bonus only carries over at whatever damage left it at
(damage burns the bonus down before it touches the base), and it's gone entirely once the tank
dies. The shop only shows the bonus amount (`reinforcedHp`/100), not a combined hp/maxHp line.
Also made the tank behind on rounds/kills go first from round 2 on.

Then built out 20a–20h: the drive step-up fix, two more speed cuts (turn-based and real-time),
a cluster bomb nerf, a real end-of-match stats screen (shots/hits/accuracy/damage per player,
shared between turn-based and Arena), taller and more varied terrain, a sixth style (Choke
Canyon), and a new `CharacterSelectScene` for Street-Fighter-style roster picks before every
non-campaign mode. Only 20f (floating islands) is still open — it needs an actual terrain
representation change (a second layer or holes), not a tuning pass, and 20g's style *picker* is
still name-only cycling rather than a visual preview grid, both left for a dedicated session.

## Done 2026-09-09 (later)

Campaign items 4-8, presentation 27 and 29, platform 34 and 35, plus two requests that were not
on the list: the Advanced trajectory line is gone (20i) and players now drop their own tanks with
drop order setting turn order (20j).

One real bug surfaced while testing the Hive: `applyBlast` had no owner check for hardpoints, so a
boss's own barrage was destroying its own weapon mounts — the drone bay blew itself up seconds
after opening. A boss no longer damages its own hardpoints (tanks still take their own splash).

Still open and worth knowing:

- 20f (floating islands) remains the one item from the previous batch that is not done; it needs a
  terrain representation change, not a tuning pass.
- The low-HP vignette dims the HUD along with the battlefield, because camera post-FX covers
  everything on the main camera. Fixed by keeping it mild; a separate HUD camera would fix it
  properly.
- Arena still has no drop placement (turn-based only) and no replay.
- The campaign armoury spends the *lead* player's loadout; a co-op second player carries nothing.

## Done 2026-09-09 (tuning pass)

Five changes off the back of playing it:

- The shield line now scales against the tank’s own capacity (`shieldCapacity()` in
  `world.ts`), so a full Aegis shield reads as full instead of the 75% a fixed divisor gave.
- The character select screen shows the hull behind each portrait before you commit: HP,
  armour (with which way the multiplier goes), fuel, shots, climb, hitbox and the passive,
  and it warns in red when a mode substitutes the hull (Aegis and Strider are Advanced-only,
  so Modern quietly gave you a Line tank). Mouse hover browses the roster.
- Aegis shield regen cut from 18 to 10 a turn.
- Characters now differ in fuel outside the campaign too: `core/characters.ts` applies the
  commander’s fuel bonus on top of the hull, so Kilo/Aegis runs 130 against Grimm/Bulwark’s
  55. Nothing else from a commander perk applies outside the campaign.
- Fuel stays usable after the shot is away: the shooter can keep driving while the shell is
  in the air, which makes a long lob a commitment. Turn-based only, and drive input only —
  aim and power are locked once fired.

## Done 2026-09-09 (bug + balance pass)

- **The starting weapons the blurbs promise are actually issued.** `perk.startWeapons` was
  campaign-only, so "starts with a railgun" was a lie in a normal battle.
  `startingAmmoFor()` now hands them out in turn-based and Arena, filtered to what the
  mode's armoury stocks (Classic cannot be given a railgun), and the select screen lists
  the kit item by item instead of leaving it to the prose.
- **Losing a round pays a consolation** (`lossReward`, new field on GameMode: 470 / 530 /
  600 by mode, roughly a third of a kill) so a losing player can still shop. A draw pays
  everyone.
- **Fixed: the human was auto-placed after leaving the armoury.** The SPACE that closed the
  shop was still in the InputRouter's held set when the battle scene woke — the scene slept
  through its keyup — and the placement phase read it as a confirmation on frame one. Two
  fixes: `InputRouter.clearHeld()` on scene WAKE, and the drop marker arms its latch for
  each new chooser, so a key already down can never place a tank.
- **Napalm nerfed.** All nine streams started within a jittered ±28 px of the impact, so on
  flat ground (where the fluid has nowhere to run) a direct hit stacked the lot: ~126
  damage for 1600 credits, more than a 4200-credit nuke. Streams are now spaced
  deterministically 16 px apart and per-stream damage is 14 -> 11. A point-blank hit
  measures 53, against heavy shell 58, thermobaric 74 and nuke 100.

## Done 2026-09-10

- **Fixed: the shell left from above the barrel.** `muzzle()` spawned from the unrotated
  barrel pivot while the renderer draws that pivot leaning with the hull, so on a slope the
  spawn point sat 9-21 px off the drawn barrel (measured at tilt 0.15-0.35). The lean now
  lives in one place, `hullRotation()` in `world.ts`, which both the renderer and `muzzle()`
  use, and the sprite-hull path publishes its real barrel geometry instead of leaving
  `muzzle()` on a class-default fallback that ignored the pivot entirely. Error is now 0 at
  every tilt and facing; `tests/muzzle.test.ts` pins it, including a test that fails if the
  old unrotated geometry comes back.

## Done 2026-09-10 (touch, pause, exit prompt)

**Touch controls** — not a separate mode: a third Intent source next to keyboard and gamepad
(`touchControls.ts`), so the rules layers and the 111 core tests are untouched. Decisions taken:

- **Auto-detected, with an override.** `settings.touch` is AUTO / ON / OFF; AUTO follows
  `maxTouchPoints` + `(pointer: coarse)`. ON is how the layout gets tested with a mouse.
- **Direct manipulation, not a virtual gamepad.** Touch inside the faint ring round your tank and
  drag: the barrel follows the finger (`aimAngleFrom`), and the drag may leave the ring for a
  longer lever arm because the gesture is classified once, at touch-down. Hold anywhere else, or
  the FIRE pad, to charge; lift to fire. **A touch that starts inside the ring can never fire** —
  that dead zone is the rule asked for, applied to the FIRE pad too in case a tank is parked
  under it. A hold under 180 ms is a tap and is ignored, so a stray touch cannot spend a turn.
  Fire on touch is always hold-to-charge, whatever the FIRE setting says.
- **Drive pads** only in modes with fuel, and they keep working while the shot is in the air.
  WEAPON pad or a tap on the HUD rack cycles.
- **No Arena on touch** — a shared-keyboard mode has no finger equivalent, so it is not offered.
- **Landscape only.** A DOM overlay asks for a turn in portrait; first tap requests fullscreen and
  (Android only — iOS Safari has neither) an orientation lock.
- **No trajectory preview on touch.** Aim is harder with a finger; it stays off by design.
- **Name entry skipped on touch.** A tap on a portrait picks it and you play under that character's
  name; there is no keyboard to type on.
- **Every menu is tappable now** (all devices): the armoury has BUY / HULL / DONE and tap-to-select
  rows (second tap buys); the campaign map has DEPLOY / ARMOURY and a second tap on a node deploys;
  the commander screen has tappable difficulty and START / CONTINUE. The armoury was the hard
  blocker — it had no pointer path at all, so a touch player was trapped in it.
- **Big readouts** (angle, power, wind) drawn over the sky, since the 44 px HUD strip is illegible
  at phone scale; the keyboard status line is hidden on touch.

**Pause and exit prompt (all devices)** — ESC no longer leaves the battle outright. It opens a
prompt (LEAVE THE BATTLE?) with RESUME and EXIT TO MENU; ESC or P again resumes, ENTER or Q
confirms, and ENTER is ignored for 300 ms after the prompt opens so a fire key already on its way
down cannot confirm it. P opens the same overlay titled PAUSED. Pausing freezes the sim and the
replay, hides the touch pads, and resuming clears every held key so nothing fires or drops a tank.
On an end-of-match screen ESC still leaves directly — there is nothing left to protect.

Found while verifying the taps: **the campaign armoury had never opened.** `campaignHost()` took a
hull class id, every caller handed it the commander id, and it threw `Unknown tank class: grimm`
on both the B key and the new button. It now takes the commander id and resolves the hull itself;
`tests/shopHost.test.ts` pins it for every commander.

**Regression, fixed the same day:** the pause screen gated the killing-shot replay on `paused` —
but `startReplay()` sets `paused` itself to freeze the world during playback, so every replay
froze solid at frame one and the round never ended. On desktop the only way out was ESC into the
new prompt; on touch there was none. The replay now waits only on the pause *menu*, a tap skips
it, the results and campaign-end screens have buttons, and the touch layer has a MENU pad so the
leave prompt is always reachable. Lesson: `paused` was doing two jobs; the menu has its own flag
(`pauseUi`).

**Fullscreen from anywhere.** The F key only existed in battle and only on a keyboard, and the
auto-fullscreen on the first tap was one-way. Now a single DOM button in the top-right corner
(`#fs`, wired in `main.ts`) toggles fullscreen on every screen, on any device, and hides itself
where the browser cannot do it — iPhone Safari has no element fullscreen at all, so there the
site's "open in its own window" link is the fallback. The HUD wind gauge and the touch MENU pad
moved over to leave that corner clear.

**Three-second countdown before the first shot.** Rounds used to open with a bot firing the
instant the tanks were down, or a human firing by accident with a finger still resting from the
drop. `TurnBasedMatch` now has a `'countdown'` phase after placement (random or drop) and
`CampaignLevel` one after the briefing closes: aim and power may be set, fire and drive are
ignored, big 3 · 2 · 1 banners count it down. `countdown: 0` in the config skips it — the tests
use that, and `tests/countdown.test.ts` pins the hold itself.

Known gaps: the pads are drawn at fixed canvas positions with no safe-area insets, so a phone with
a large corner radius may clip the drive pads; two-player hotseat on touch is not addressed
(Arena is off, and turn-based passes one device between players, which works).

## Suggested order

1 → 3 → 2 (commander, difficulty, score: one coherent campaign feature), then 11, 13, 14 (feel), 26 + 27 (UI kit), 5 + 6 (Hive boss, defences), 31 (deploy so friends can play), 22 (gamepads), 23 last.
