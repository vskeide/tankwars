"""
Segment AI-generated sprite sheets into individual crisp sprites.

    py -3 tools/extract_sheets.py [sheet.png ...]      (default: every PNG in assets/raw)

For each sheet:
  1. detect the background colour (mode of the border pixels; magenta or near-black),
  2. mask everything that differs from it, close small gaps, find connected blobs,
  3. drop blobs that look like text labels (short and wide) or dust,
  4. estimate the sheet's pixel-block size and resample each sprite to a true 1-px grid
     ("crispen"), keying the background to transparent,
  5. write assets/atlas/<sheet>/<index>.png plus a JSON with boxes, block size and
     reading-order indices, and print a table so the sprites can be named in names.json.

Only numpy + Pillow. No scipy.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "public" / "atlas"


def background_colour(arr: np.ndarray) -> np.ndarray:
    h, w, _ = arr.shape
    border = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    # Quantise to 8 levels so JPEG noise votes together.
    q = (border // 32) * 32 + 16
    key, _ = Counter(map(tuple, q)).most_common(1)[0]
    # Return the mean of the border pixels that fall in that bucket.
    sel = np.all((border // 32) * 32 + 16 == key, axis=1)
    return border[sel].mean(axis=0)


def foreground_mask(arr: np.ndarray, bg: np.ndarray, tol: float) -> np.ndarray:
    diff = np.abs(arr.astype(np.int16) - bg.astype(np.int16)).sum(axis=2)
    return diff > tol


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(r):
        m = out
        out = m.copy()
        out[1:] |= m[:-1]
        out[:-1] |= m[1:]
        out[:, 1:] |= m[:, :-1]
        out[:, :-1] |= m[:, 1:]
    return out


def components(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """Return (x0, y0, x1, y1, area) for each 4-connected blob. BFS on a boolean grid."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    boxes = []
    ys, xs = np.nonzero(mask)
    for sy, sx in zip(ys, xs):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        x0 = x1 = sx
        y0 = y1 = sy
        area = 0
        while q:
            y, x = q.popleft()
            area += 1
            x0, x1 = min(x0, x), max(x1, x)
            y0, y1 = min(y0, y), max(y1, y)
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        boxes.append((x0, y0, x1, y1, area))
    return boxes


def estimate_block(arr: np.ndarray, mask: np.ndarray) -> float:
    """
    Pixel-block size of the sheet. AI pixel art has edges at (roughly) regular spacing;
    the autocorrelation of the horizontal gradient peaks at the block size.
    """
    gray = arr.mean(axis=2)
    gx = np.abs(np.diff(gray, axis=1))
    gx[~mask[:, 1:]] = 0
    row = gx.sum(axis=0)
    row = row - row.mean()
    ac = np.correlate(row, row, mode="full")[len(row) - 1 :]
    ac[:2] = 0
    lo, hi = 2, 12
    peak = int(np.argmax(ac[lo:hi])) + lo
    # Refine with a parabola through the neighbours for sub-pixel block size.
    if 1 <= peak < len(ac) - 1:
        a, b, c = ac[peak - 1], ac[peak], ac[peak + 1]
        denom = a - 2 * b + c
        if denom != 0:
            peak = peak + 0.5 * (a - c) / denom
    return float(peak)


def crispen(sprite: np.ndarray, alpha: np.ndarray, block: float, key_is_magenta: bool = False) -> Image.Image:
    """Resample to one output pixel per block, sampling at block centres, with a small
    majority vote against JPEG haze."""
    h, w, _ = sprite.shape
    ow = max(1, int(round(w / block)))
    oh = max(1, int(round(h / block)))
    out = np.zeros((oh, ow, 4), dtype=np.uint8)
    for oy in range(oh):
        cy = int((oy + 0.5) * block)
        y0, y1 = max(0, cy - 1), min(h, cy + 2)
        for ox in range(ow):
            cx = int((ox + 0.5) * block)
            x0, x1 = max(0, cx - 1), min(w, cx + 2)
            a = alpha[y0:y1, x0:x1]
            if a.mean() < 0.5:
                continue
            block_px = sprite[y0:y1, x0:x1].reshape(-1, 3)
            med = np.median(block_px, axis=0)
            # Despill: anti-aliased edges against a magenta key come out pink.
            # Drop pixels that are mostly key colour, and pull the key out of the rest.
            if key_is_magenta:
                spill = min(med[0], med[2]) - med[1]
                if spill > 60:
                    continue
                if spill > 0:
                    med[0] -= spill * 0.5
                    med[2] -= spill * 0.5
            out[oy, ox, :3] = np.clip(med, 0, 255)
            out[oy, ox, 3] = 255
    return Image.fromarray(out, "RGBA")


def order_by_rows(boxes, rows: int | None):
    """Sort sprites into reading order. With `rows` given, y-centres are clustered into
    exactly that many rows by cutting at the largest gaps; otherwise a gap larger than
    half the median sprite height starts a new row."""
    if not boxes:
        return boxes
    items = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    centres = [(b[1] + b[3]) / 2 for b in items]
    gaps = [(centres[i + 1] - centres[i], i) for i in range(len(centres) - 1)]
    if rows and rows > 1:
        cuts = sorted(i for _, i in sorted(gaps, reverse=True)[: rows - 1])
    else:
        med_h = sorted(b[3] - b[1] for b in items)[len(items) // 2]
        cuts = [i for g, i in gaps if g > med_h * 0.5]
    out = []
    start = 0
    for c in cuts + [len(items) - 1]:
        row = sorted(items[start : c + 1], key=lambda b: b[0])
        out.extend(row)
        start = c + 1
    return out


def process(path: Path, rows: int | None = None) -> None:
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img)
    bg = background_colour(arr)
    dark_bg = bg.sum() < 150
    tol = 60 if dark_bg else 90
    mask = foreground_mask(arr, bg, tol)
    # Pull the anti-aliased fringe in so blobs do not bleed into each other,
    # then grow so a sprite split by a thin dark gap still counts as one.
    # Pass 1: find small text-like blobs (labels, underlines) and erase them from the
    # mask so they cannot be merged into a neighbouring sprite in pass 2.
    for x0, y0, x1, y1, area in components(dilate(mask, 1)):
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        if bh < 26 or (bh < 40 and bw > bh * 2.5 and area < 2500):
            mask[y0 : y1 + 1, x0 : x1 + 1] = False
    # Pass 2: group generously so a sprite split by a thin dark gap stays whole.
    blobs = components(dilate(mask, 3))
    block = FORCE_BLOCK.get(path.stem) or estimate_block(arr, mask)

    h, w = mask.shape
    kept = []
    for x0, y0, x1, y1, area in blobs:
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        if area < 120:
            continue  # dust
        if bw < 14 or bh < 14:
            continue
        kept.append((x0, y0, x1, y1))

    # Reading order: cluster y-centres into rows (split at the largest gaps), then x.
    kept = order_by_rows(kept, rows)

    out_dir = OUT / path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.png"):
        old.unlink()

    meta = {"sheet": path.name, "size": [w, h], "background": [int(v) for v in bg], "block": round(block, 3), "sprites": []}
    for i, (x0, y0, x1, y1) in enumerate(kept):
        pad = 2
        x0p, y0p = max(0, x0 - pad), max(0, y0 - pad)
        x1p, y1p = min(w - 1, x1 + pad), min(h - 1, y1 + pad)
        sprite = arr[y0p : y1p + 1, x0p : x1p + 1]
        alpha = foreground_mask(sprite, bg, tol * 0.7)
        crisp = crispen(sprite, alpha, block, key_is_magenta=not dark_bg)
        name = f"{i:02d}"
        crisp.save(out_dir / f"{name}.png")
        meta["sprites"].append({"index": i, "box": [int(x0p), int(y0p), int(x1p), int(y1p)], "size": list(crisp.size)})
    (out_dir / "sheet.json").write_text(json.dumps(meta, indent=2))

    print(f"{path.name}: bg={meta['background']} block={block:.2f}px  {len(kept)} sprites -> {out_dir.relative_to(ROOT)}")
    for s in meta["sprites"]:
        b = s["box"]
        print(f"  {s['index']:02d}  box=({b[0]},{b[1]})-({b[2]},{b[3]})  crisp={s['size'][0]}x{s['size'][1]}")


# Sheets whose sprites are animation frames laid out in rows: name -> row count.
ROW_SHEETS = {"fx-explosions": 4, "fx-misc": 8, "terrain-tiles": 2, "ui": 3}
# Not sprite sheets: whole images used as-is (title, map) or sliced by hand (backdrops).
SKIP = {"title", "campaign-map", "bg-all", "bg-dunes", "bg-mesas", "bg-crags", "bg-basin", "bg-spires"}
# Override the detected block size so related sheets come out at a consistent in-game
# size: a player hull should be ~110 px wide, its turret ~50 px, its barrel ~55 px long.
# Sampling the original at a coarser grid beats rescaling the crisp output later.
FORCE_BLOCK = {
    "player-hulls": 2.9, "player-turrets": 5.7, "barrels": 4.1,
    "enemy-hulls": 3.2, "enemy-turrets": 7.2, "enemy-barrels": 6.9,
    "projectiles": 4.8, "pickups": 3.5,
}


def main(argv: list[str]) -> None:
    files = [Path(a) for a in argv[1:]] or sorted(RAW.glob("*.png"))
    if not files:
        print("no sheets in", RAW)
        return
    for f in files:
        if f.stem in SKIP:
            print(f"{f.name}: skipped (whole-image asset)")
            continue
        process(f, ROW_SHEETS.get(f.stem))


if __name__ == "__main__":
    main(sys.argv)
