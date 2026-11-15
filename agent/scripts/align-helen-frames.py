#!/usr/bin/env python3
"""Align hand-made Helen expression frames to the base portrait and composite only the face.

Inputs : agent/assets/avatars/helen.png            (base, "neutral")
         agent/assets/avatars/helen-frames/<name>.jpg (Gemini edits of helen.png)
Outputs: agent/assets/avatars/helen-frames/aligned/
           <name>.png          full frame: base portrait + that frame's face (feathered, colour-matched)
           neutral.png         copy of the base, for symmetry
           patches/mouth_<v>.png, patches/eyes_<v>.png   RGBA feathered patches (closed/open = neutral)
           patches/patches.json  where each patch goes on the base (x, y, w, h)
           _report.json        per-frame alignment / diff / watermark numbers
           _sheet.png          labelled contact sheet
           _flicker.gif        neutral -> frame -> neutral ... flicker test

Pipeline per frame:
  1. resize to the base size (INTER_AREA)
  2. SIFT features on the non-face area only (hair, crown, shoulders, clothing) -> RANSAC similarity,
     then ECC affine refinement on the same mask; keep whichever has the lower masked error
  3. Lab mean/std colour match of the warped frame's skin to the base skin
  4. composite inside the face mask (forehead->chin, ear->ear, earrings cut out) with a feathered alpha
     that is exactly 0 outside the mask, so hair/crown/earrings/clothing are the base pixels

Setup (not part of the Node toolchain):
  python3 -m venv .venv && .venv/bin/pip install opencv-python-headless numpy pillow
  .venv/bin/python agent/scripts/align-helen-frames.py [--skip name,name]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "assets" / "avatars"
BASE = ROOT / "helen.png"
SRC = ROOT / "helen-frames"
OUT = SRC / "aligned"

FRAMES = [
    "smile", "pleased", "concerned", "serious", "thinking", "surprised", "listening", "looking",
    "goodbye", "mouth_ah", "mouth_oo", "mouth_ee", "mouth_slight", "blink", "blink_half",
]
MOUTH = ["mouth_ah", "mouth_oo", "mouth_ee", "mouth_slight"]
EYES = ["blink", "blink_half"]

# Geometry in base-image pixels (768x768), measured on helen.png.
FACE_CENTER = (387, 292)
FACE_AXES = (114, 152)            # half-width ear-to-ear, half-height hairline-to-chin
EARRINGS = [(250, 322, 32, 76), (486, 322, 32, 76)]  # x, y, w, h — always kept from the base
FEATHER = 14                      # px ramp inside the mask edge
EYE_BOX = (276, 196, 222, 90)     # x, y, w, h  both eyes + lids
MOUTH_BOX = (320, 330, 134, 100)  # x, y, w, h  lips + jaw drop room
CORNER = 0.10                     # corner size (fraction of side) searched for the Gemini sparkle


def face_mask(h: int, w: int) -> tuple[np.ndarray, np.ndarray]:
    """Hard mask (uint8 0/255) and feathered alpha (float 0..1, exactly 0 outside the hard mask)."""
    hard = np.zeros((h, w), np.uint8)
    cv2.ellipse(hard, FACE_CENTER, FACE_AXES, 0, 0, 360, 255, -1)
    for x, y, ew, eh in EARRINGS:
        cv2.rectangle(hard, (x, y), (x + ew, y + eh), 0, -1)
    dist = cv2.distanceTransform(hard, cv2.DIST_L2, 5)
    t = np.clip(dist / FEATHER, 0, 1)
    alpha = t * t * (3 - 2 * t)  # smoothstep
    return hard, alpha.astype(np.float32)


def box_alpha(w: int, h: int, feather: int = 10) -> np.ndarray:
    """Feathered elliptical alpha for a patch box."""
    hard = np.zeros((h, w), np.uint8)
    cv2.ellipse(hard, (w // 2, h // 2), (w // 2 - 1, h // 2 - 1), 0, 0, 360, 255, -1)
    t = np.clip(cv2.distanceTransform(hard, cv2.DIST_L2, 5) / feather, 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def masked_mae(a: np.ndarray, b: np.ndarray, m: np.ndarray) -> float:
    d = np.abs(a.astype(np.float32) - b.astype(np.float32)).mean(axis=2)
    return float(d[m > 0].mean()) if (m > 0).any() else float("nan")


def align(base: np.ndarray, img: np.ndarray, region: np.ndarray):
    """Return (2x3 matrix, info) warping img onto base using only `region` (non-face) pixels."""
    h, w = base.shape[:2]
    gb, gi = (cv2.cvtColor(x, cv2.COLOR_BGR2GRAY) for x in (base, img))
    sift = cv2.SIFT_create(nfeatures=4000)
    kb, db = sift.detectAndCompute(gb, region)
    # The frame's face is somewhere else before alignment, so feature-detect it unmasked
    # and let the ratio test + RANSAC reject the face matches.
    ki, di = sift.detectAndCompute(gi, None)
    matches = cv2.BFMatcher(cv2.NORM_L2).knnMatch(di, db, k=2)
    good = [m for m, n in (p for p in matches if len(p) == 2) if m.distance < 0.75 * n.distance]
    src = np.float32([ki[m.queryIdx].pt for m in good])
    dst = np.float32([kb[m.trainIdx].pt for m in good])
    M, inl = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3.0,
                                         maxIters=5000, confidence=0.999)
    inl = inl.ravel().astype(bool)
    proj = src[inl] @ M[:, :2].T + M[:, 2]
    reproj = np.linalg.norm(proj - dst[inl], axis=1)

    def score(Mx):
        warped = cv2.warpAffine(img, Mx, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        valid = cv2.warpAffine(np.full((h, w), 255, np.uint8), Mx, (w, h), flags=cv2.INTER_NEAREST)
        return masked_mae(warped, base, cv2.bitwise_and(region, valid))

    info = {
        "matches": len(good), "inliers": int(inl.sum()),
        "reproj_median_px": float(np.median(reproj)), "reproj_p90_px": float(np.percentile(reproj, 90)),
        "scale": float(np.hypot(M[0, 0], M[1, 0])), "rotation_deg": float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))),
        "tx": float(M[0, 2]), "ty": float(M[1, 2]), "method": "sift-similarity",
    }
    best, best_s = M.astype(np.float32), score(M)
    try:  # ECC refinement: warp maps base coords -> img coords, so start from the inverse.
        Minv = cv2.invertAffineTransform(M).astype(np.float32)
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
        _, Mecc = cv2.findTransformECC(gb, gi, Minv, cv2.MOTION_AFFINE, crit, region, 5)
        Me = cv2.invertAffineTransform(Mecc).astype(np.float32)
        s = score(Me)
        if s < best_s:
            best, best_s, info["method"] = Me, s, "sift-similarity+ecc-affine"
    except cv2.error:
        pass
    info["outside_mae_after_align"] = best_s
    return best, info


def lab_match(src: np.ndarray, ref: np.ndarray, m: np.ndarray) -> tuple[np.ndarray, dict]:
    a = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    sel = m > 0
    ms, ss = a[sel].mean(0), a[sel].std(0) + 1e-6
    mr, sr = b[sel].mean(0), b[sel].std(0)
    out = (a - ms) / ss * sr + mr
    out = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    return out, {"lab_mean_shift": (mr - ms).round(2).tolist(), "lab_std_ratio": (sr / ss).round(3).tolist()}


def sparkle_score(warped: np.ndarray, base: np.ndarray, valid: np.ndarray) -> list[dict]:
    """Look for a small bright blob (Gemini's 4-point sparkle) in each corner of the aligned frame
    that is not in the base. Working on the difference cancels clothing/background texture."""
    g = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gb = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY).astype(np.float32)
    d = (g - cv2.GaussianBlur(g, (0, 0), 4)) - (gb - cv2.GaussianBlur(gb, (0, 0), 4))
    d[valid == 0] = 0
    h, w = g.shape
    c = int(min(h, w) * CORNER)
    res = []
    for name, (y0, x0) in {"tl": (0, 0), "tr": (0, w - c), "bl": (h - c, 0), "br": (h - c, w - c)}.items():
        patch = d[y0:y0 + c, x0:x0 + c]
        bright = (patch > 25).astype(np.uint8)
        n, lab, stats, cents = cv2.connectedComponentsWithStats(bright)
        blobs = [(stats[i, cv2.CC_STAT_AREA], cents[i]) for i in range(1, n) if 4 <= stats[i, cv2.CC_STAT_AREA] <= 400]
        best = max(blobs, key=lambda b: b[0]) if blobs else None
        res.append({"corner": name, "peak": round(float(patch.max()), 1), "blob_px": int(best[0]) if best else 0,
                    "base_xy": [round(float(x0 + best[1][0]), 1), round(float(y0 + best[1][1]), 1)] if best else None})
    return res


def label(img: np.ndarray, text: str) -> np.ndarray:
    out = img.copy()
    cv2.rectangle(out, (0, out.shape[0] - 30), (out.shape[1], out.shape[0]), (0, 0, 0), -1)
    cv2.putText(out, text, (8, out.shape[0] - 9), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip", default="", help="comma-separated frame names to leave out")
    args = ap.parse_args()
    skip = {s for s in args.skip.split(",") if s}

    base = cv2.imread(str(BASE), cv2.IMREAD_COLOR)
    h, w = base.shape[:2]
    hard, alpha = face_mask(h, w)
    region = cv2.bitwise_not(cv2.dilate(hard, np.ones((25, 25), np.uint8)))  # alignment uses non-face only
    skin = hard.copy()
    for x, y, bw, bh in (EYE_BOX, MOUTH_BOX):
        skin[y:y + bh, x:x + bw] = 0
    seam = ((alpha > 0) & (alpha < 0.5)).astype(np.uint8)
    (OUT / "patches").mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT / "neutral.png"), base)

    hashes: dict[str, str] = {}
    report: dict = {"base": str(BASE.relative_to(ROOT.parents[2])), "size": [w, h], "frames": {}}
    results: dict[str, np.ndarray] = {"neutral": base}

    for name in FRAMES:
        p = SRC / f"{name}.jpg"
        r: dict = {}
        report["frames"][name] = r
        if not p.exists():
            r["status"] = "missing"
            continue
        digest = hashlib.md5(p.read_bytes()).hexdigest()
        dup = [k for k, v in hashes.items() if v == digest]
        hashes[name] = digest
        if dup:
            r["duplicate_of"] = dup
        if name in skip:
            r["status"] = "skipped"
            continue

        raw = cv2.imread(str(p), cv2.IMREAD_COLOR)
        img = cv2.resize(raw, (w, h), interpolation=cv2.INTER_AREA)
        M, info = align(base, img, region)
        r.update(info)
        warped = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        valid = cv2.warpAffine(np.full((h, w), 255, np.uint8), M, (w, h), flags=cv2.INTER_NEAREST)
        out_region = cv2.bitwise_and(region, valid)
        d = np.abs(warped.astype(np.float32) - base.astype(np.float32)).mean(2)[out_region > 0]
        r["outside_mae"] = float(d.mean())
        r["outside_p95"] = float(np.percentile(d, 95))
        r["outside_frac_gt30"] = float((d > 30).mean())

        matched, cm = lab_match(warped, base, skin)
        r["color"] = cm
        r["seam_mae"] = masked_mae(matched, base, seam)
        r["eye_change"] = masked_mae(matched, base, _box(h, w, EYE_BOX))
        r["mouth_change"] = masked_mae(matched, base, _box(h, w, MOUTH_BOX))

        a3 = alpha[..., None]
        comp = np.clip(base * (1 - a3) + matched * a3 + 0.5, 0, 255).astype(np.uint8)
        cv2.imwrite(str(OUT / f"{name}.png"), comp)
        results[name] = comp
        r["status"] = "ok"
        r["pixels_changed_outside_mask"] = int((np.abs(comp.astype(int) - base).max(2)[hard == 0] > 0).sum())

        # Watermark: any sparkle-like blob in a corner must sit where alpha == 0 and be absent from the output.
        sp = sparkle_score(warped, base, valid)
        marks = []
        for c in sp:
            if c["blob_px"]:
                ix, iy = (int(v) for v in c["base_xy"])
                win = (slice(max(0, iy - 12), iy + 13), slice(max(0, ix - 12), ix + 13))
                marks.append({**c, "alpha_at_mark": float(alpha[win].max()),
                              "output_max_diff_near_mark": int(np.abs(comp[win].astype(int) - base[win]).max())})
        r["watermark"] = marks
        r["corners"] = sp
        corner = int(min(h, w) * CORNER)
        r["corner_alpha_max"] = float(max(alpha[:corner, :corner].max(), alpha[:corner, -corner:].max(),
                                          alpha[-corner:, :corner].max(), alpha[-corner:, -corner:].max()))

    # Patches (closed / open = neutral).
    patch_meta = {}
    for kind, box, variants in (("mouth", MOUTH_BOX, {"closed": "neutral", **{m[6:]: m for m in MOUTH}}),
                                ("eyes", EYE_BOX, {"open": "neutral", **{e: e for e in EYES}})):
        x, y, bw, bh = box
        a = (box_alpha(bw, bh) * 255).astype(np.uint8)
        for v, src in variants.items():
            if src not in results:
                continue
            rgba = cv2.cvtColor(results[src][y:y + bh, x:x + bw], cv2.COLOR_BGR2BGRA)
            rgba[..., 3] = a
            cv2.imwrite(str(OUT / "patches" / f"{kind}_{v}.png"), rgba)
            patch_meta[f"{kind}_{v}"] = {"x": x, "y": y, "w": bw, "h": bh, "source": src}
    (OUT / "patches" / "patches.json").write_text(json.dumps(patch_meta, indent=2) + "\n")

    # Contact sheet + flicker GIF.
    names = ["neutral"] + [n for n in FRAMES if n in results]
    tile = 256
    cols = 4
    rows = -(-len(names) // cols)
    sheet = np.full((rows * tile, cols * tile, 3), 255, np.uint8)
    for i, n in enumerate(names):
        t = label(cv2.resize(results[n], (tile, tile), interpolation=cv2.INTER_AREA), n)
        sheet[(i // cols) * tile:(i // cols + 1) * tile, (i % cols) * tile:(i % cols + 1) * tile] = t
    cv2.imwrite(str(OUT / "_sheet.png"), sheet)

    gif_size = 384
    seq = []
    for n in names[1:]:
        seq += ["neutral", n]
    seq.append("neutral")
    frames = [Image.fromarray(cv2.cvtColor(label(cv2.resize(results[n], (gif_size, gif_size),
                                                              interpolation=cv2.INTER_AREA), n), cv2.COLOR_BGR2RGB))
              for n in seq]
    frames[0].save(OUT / "_flicker.gif", save_all=True, append_images=frames[1:], duration=450, loop=0,
                   optimize=True)

    (OUT / "_report.json").write_text(json.dumps(report, indent=2) + "\n")
    print_table(report)


def _box(h: int, w: int, box) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    x, y, bw, bh = box
    m[y:y + bh, x:x + bw] = 255
    return m


def print_table(report: dict) -> None:
    print(f"{'frame':<13}{'status':<9}{'inl':>5}{'reproj':>8}{'scale':>7}{'outMAE':>8}{'out>30':>8}"
          f"{'seam':>7}{'eyeΔ':>7}{'mouthΔ':>8}  watermark / notes")
    for n, r in report["frames"].items():
        if r.get("status") != "ok":
            print(f"{n:<13}{r.get('status', '?'):<9}  dup={r.get('duplicate_of')}")
            continue
        wm = ",".join(f"{m['corner']}(α={m['alpha_at_mark']:.0f},Δ={m['output_max_diff_near_mark']})"
                      for m in r["watermark"]) or "-"
        print(f"{n:<13}{'ok':<9}{r['inliers']:>5}{r['reproj_median_px']:>8.2f}{r['scale']:>7.3f}"
              f"{r['outside_mae']:>8.2f}{r['outside_frac_gt30']:>8.1%}{r['seam_mae']:>7.2f}"
              f"{r['eye_change']:>7.2f}{r['mouth_change']:>8.2f}  {wm}"
              f"{'  dup=' + str(r['duplicate_of']) if r.get('duplicate_of') else ''}")


if __name__ == "__main__":
    main()
