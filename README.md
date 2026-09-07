# TANKWARS

A modern take on *Tank Wars* (DOS, 1991): turn-based artillery with destructible terrain,
wind, a between-round shop — plus tank classes, fifteen weapons, a real-time hotseat
arena for up to four players on one keyboard, and (coming) a campaign with bosses.

16-bit pixel art on a native 1080p grid, sprites at 2×. Browser only, no install.

## Modes

| Mode | What |
|---|---|
| **Classic** | One hull, one shot, wind per round. Six weapons. The original, repainted |
| **Modern** | Pick a hull (armour, shots, passive). Twelve weapons incl. MIRV, napalm, railgun. Wind every turn. Fall damage |
| **Advanced** | Modern plus fuel: drive along the ridge. Shields, legged hulls, Earthmover. Fifteen weapons |
| **Arena** | Real time. Everyone at once, hold fire to charge, crates parachute in |

## Controls

Turn-based (hotseat, shared keyboard): `←→` aim · `↑↓` power · `A/D` drive (Advanced) ·
`Space` fire · `Tab` weapon · `P` pause · `M` mute · `Esc` menu.

Arena and Campaign (real time): left/right drive, up/down aim, **hold fire to charge,
release to shoot**, `Tab` weapon. Solo: any key set works (WASD or arrows, Space or Enter).
Hotseat: P1 `WASD` + `Space`/`Q` · P2 arrows + `Enter`/`RShift` · P3 `IJKL` + `O`/`U` ·
P4 numpad `4/6/8/5` + `0`/`+`. Gamepads map to free slots. `N` toggles music.

## Develop

```bash
npm install
npm run dev      # http://localhost:5180
```

Art pipeline: see `assets/PROMPTS.md` and `tools/extract_sheets.py`. Architecture and
rules for contributors (human or AI): `AGENTS.md`.
