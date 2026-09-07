# TANKWARS — suggested implementations

Prioritised backlog. Effort: S = under an hour, M = an evening, L = several sessions.
Items marked ★ were asked for by Vebjørn; the rest are my suggestions.

## Campaign

| # | Item | Effort | Notes |
|---|---|---|---|
| 1 | ★ **Choose a commander** before the campaign: six portraits, each tied to a hull class and a small perk (e.g. +fuel, +1 starting weapon, faster reload, tougher armour) | M | Portraits exist (`portrait.p1–p6`); perks reuse `TankPerk`. Selection screen sits before the map |
| 2 | ★ **Campaign score & high-score table**: time to finish, damage taken, shots fired, accuracy, crates collected, deaths/retries, difficulty multiplier → one score; per-commander and overall best in `localStorage`, shown on the map and on completion | M | Needs a difficulty setting (3) to be meaningful; export/import as JSON so scores survive a browser wipe |
| 3 | **Campaign difficulty** (Recruit / Soldier / Veteran / Ironman): enemy accuracy, boss HP/tempo, crate rate; Ironman = no retries, run ends on death | S | Score multiplier feeds item 2 |
| 4 | **Level intro cards** with commander portrait, mission brief and enemy roster; boss taunt lines on phase changes | S | Copy exists in `levels.ts`; make it voice-less dialogue boxes |
| 5 | **Third boss (Hive Crawler)** in the campaign: legged body, drone launcher, three mounts already detected; drones as small flying hardpoints that dive at the player | M | Sprites and mounts are in; needs a `drone` attack kind in `bosses.ts` |
| 6 | **Stationary defences** on later levels: gun turret and missile launcher sprites from the misc sheet as immobile hardpoints | S | World already treats hardpoints generically |
| 7 | **Mines and explosive barrels** placed by level scripts; barrels chain-react | S | Sprites exist (`hazard.mine`, `barrel.explosive`) |
| 8 | **Between-level shop** in campaign with the credits earned (repairs, ammo), so choices carry between missions | S | Reuse `ShopScene` |
| 9 | **Story thread**: four or five lines per act (three acts = three biomes on the map), written in Nynorsk and English toggle | S | Content pass, no code beyond a language setting |
| 10 | **Secret/optional nodes** on the map (two unused markers): bonus missions with rare weapons | S | Map has 14 markers, 12 used |

## Gameplay & feel

| # | Item | Effort | Notes |
|---|---|---|---|
| 11 | **Turret tilts with the hull** on slopes; barrel pivot follows | S | Cosmetic but very visible on dunes |
| 12 | **Hold-to-charge as an option in turn-based** modes (setting), for players who prefer the Arena feel | S | Setting + `turnIntent` change |
| 13 | **Tank drive animation**: track-link scroll and slight hull bob while moving; dust behind | S | `fx.dust` exists; tracks need a 2-frame offset trick on the hull sprite |
| 14 | **Damage states**: soot/crack overlay at <50 % and <25 % HP, smoke already there | S | Procedural overlay on the hull texture |
| 15 | **Wind gusts** in real-time modes (wind drifts smoothly instead of stepping) and a visible wind sock/particles | S | HUD gauge already animates |
| 16 | **Shot camera**: brief follow-cam on long shots in turn-based (zoom out to show the whole arc, then punch in on impact) | M | Camera already supports zoom; needs a small state machine |
| 17 | **Replay of the killing shot** at round end, slow-motion | M | Core is deterministic; record the inputs of the last turn and re-simulate |
| 18 | **Weather/time of day** per round: night rounds with tracer glow, sandstorm rounds with reduced visibility and stronger wind | M | Backdrop tint + particle layer + wind range |
| 19 | **More weapons** to round out the 15: guided missile (steer while in flight), teleporter, dirt bomb (buries a target), shield generator drop | M | Behaviours in `world.ts`; sprites needed |
| 20 | **Bot personalities**: aggressive / cautious / crate-hunter, chosen per bot; taunt lines | S | Profiles in `ai.ts` |

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
| 27 | **Weapon icons in the shop** and a weapon preview (blast radius circle on the terrain when selecting) | S | Icons exist |
| 28 | **Title screen attract mode**: bots play a demo round behind the menu | S | Start a bot-only battle scene underneath the menu |
| 29 | **Screen effects**: chromatic flash on nukes, heat-haze over napalm, vignette on low HP | S | Phaser post-FX pipelines |
| 30 | **Localisation**: Nynorsk/English toggle for all UI text | M | String table; Nynorsk via the `nynorsk-writing` skill |

## Platform & tooling

| # | Item | Effort | Notes |
|---|---|---|---|
| 31 | **Static deploy** to GitHub Pages / Cloudflare Pages so it plays from a URL on any machine | S | `vite build` + one workflow file |
| 32 | **Desktop build** (Tauri or Electron) for a Steam-like windowed app with fullscreen and gamepad focus | M | Tauri keeps it small |
| 33 | **Settings screen**: volume sliders, tank size, aim speed, key rebinding per slot, colour-blind team palette | M | `settings.ts` exists |
| 34 | **Save/continue a turn-based match** (serialise World + match state) | S | Core is plain data |
| 35 | **Unit tests for the core** (vitest): ballistics, terrain collapse, damage falloff, bot solver convergence | S | `tools/smoke.ts` is the seed |
| 36 | **Asset pipeline hardening**: `npm run assets` runs extractor + mounts + contact sheets; a check that every id in `names.json` has a file | S | Makes new sheets a one-command drop-in |

## Suggested order

1 → 3 → 2 (commander, difficulty, score: one coherent campaign feature), then 11, 13, 14 (feel), 26 + 27 (UI kit), 5 + 6 (Hive boss, defences), 31 (deploy so friends can play), 22 (gamepads), 23 last.
