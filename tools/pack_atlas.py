"""
Pack the extracted per-sprite PNGs into one sheet per group.

    py -3 tools/pack_atlas.py

Reads public/atlas/<group>/NN.png plus names.json and writes
public/packed/<group>.png and public/packed/<group>.json, plus a manifest.
The game loads ~18 sheets instead of ~340 files, then splits the frames back
into individual textures at boot so every sprite id keeps working unchanged.

Sprites are placed with a simple shelf packer, sorted by height; that is within
a few per cent of optimal for this kind of content and keeps the code short.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "public" / "atlas"
OUT = ROOT / "public" / "packed"
PAD = 1  # transparent gutter so neighbouring frames cannot bleed


def pack_group(group: Path) -> dict | None:
    names_file = group / "names.json"
    if not names_file.exists():
        return None
    names = {k: v for k, v in json.loads(names_file.read_text()).items() if not k.startswith("_")}
    scale = json.loads(names_file.read_text()).get("_scale", 2)

    sprites = []
    for index, sid in names.items():
        f = group / f"{index}.png"
        if not f.exists():
            print(f"  ! {group.name}/{index}.png missing (id {sid})")
            continue
        sprites.append((sid, Image.open(f).convert("RGBA")))
    if not sprites:
        return None

    # Shelf packing: tallest first, rows as wide as the sheet.
    sprites.sort(key=lambda s: -s[1].height)
    total_area = sum((im.width + PAD) * (im.height + PAD) for _, im in sprites)
    width = max(max(im.width for _, im in sprites) + PAD, int(total_area**0.5 * 1.15))
    x = y = row_h = 0
    frames: dict[str, dict] = {}
    for sid, im in sprites:
        if x + im.width + PAD > width:
            x = 0
            y += row_h + PAD
            row_h = 0
        frames[sid] = {"x": x, "y": y, "w": im.width, "h": im.height}
        x += im.width + PAD
        row_h = max(row_h, im.height)
    height = y + row_h + PAD

    sheet = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for sid, im in sprites:
        f = frames[sid]
        sheet.paste(im, (f["x"], f["y"]))

    OUT.mkdir(parents=True, exist_ok=True)
    png = OUT / f"{group.name}.png"
    sheet.save(png, optimize=True)
    (OUT / f"{group.name}.json").write_text(json.dumps({"scale": scale, "frames": frames}, indent=1))
    print(f"  {group.name}: {len(frames)} frames  {width}x{height}  {png.stat().st_size // 1024} KB")
    return {"group": group.name, "frames": len(frames)}


def main() -> None:
    groups = []
    for d in sorted(ATLAS.iterdir()):
        if not d.is_dir():
            continue
        info = pack_group(d)
        if info:
            groups.append(info["group"])
    (OUT / "manifest.json").write_text(json.dumps({"groups": groups}, indent=1))
    total = sum(len(json.loads((OUT / f"{g}.json").read_text())["frames"]) for g in groups)
    print(f"packed {total} sprites into {len(groups)} sheets -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
