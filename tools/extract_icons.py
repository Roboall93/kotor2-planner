"""Extract the feat and Force power icons the planner uses from a KOTOR2 install.

Usage: python tools/extract_icons.py "<KOTOR2 install dir>" app/src/data/rules.json app/public/icons

Only icons named by rules.json are written (as PNG). The icons are Lucasfilm's
artwork, so they live in their own folder: deleting app/public/icons makes the
app fall back to plain text, no code change needed.
"""
import json
import os
import struct
import sys

from PIL import Image

RES_TGA, RES_TPC = 3, 3007


def erf_index(path):
    """resref -> (path, offset, size, restype) for TPC/TGA entries in an ERF."""
    with open(path, "rb") as fh:
        head = fh.read(160)
        count, off_keys, off_res = struct.unpack_from("<I4xII", head, 16)
        fh.seek(off_keys)
        keys = fh.read(count * 24)
        fh.seek(off_res)
        res = fh.read(count * 8)
    out = {}
    for i in range(count):
        resref = keys[i * 24:i * 24 + 16].rstrip(b"\0").decode("ascii", "replace").lower()
        restype = struct.unpack_from("<H", keys, i * 24 + 20)[0]
        if restype in (RES_TGA, RES_TPC):
            off, size = struct.unpack_from("<II", res, i * 8)
            out.setdefault(resref, (path, off, size, restype))
    return out


def decode_tpc(buf):
    """TPC rows are stored bottom-up, so the decoded image is flipped upright."""
    data_size, _alpha, w, h, enc, _mips = struct.unpack_from("<IfHHBB", buf, 0)
    pix = buf[128:]
    if data_size:  # DXT-compressed: 2 = DXT1, 4 = DXT5
        n = 1 if enc == 2 else 3
        img = Image.frombytes("RGBA", (w, h), pix[:data_size], "bcn", n)
    else:
        mode, bpp = {1: ("L", 1), 2: ("RGB", 3), 4: ("RGBA", 4)}[enc]
        img = Image.frombytes(mode, (w, h), pix[:w * h * bpp])
    return img.transpose(Image.Transpose.FLIP_TOP_BOTTOM)


def main(game, rules_path, out_dir):
    rules = json.load(open(rules_path, encoding="utf-8"))
    wanted = {x["icon"] for x in rules["feats"] + rules["powers"] if x.get("icon")}
    os.makedirs(out_dir, exist_ok=True)

    index = {}
    for pack in ("swpc_tex_gui.erf", "swpc_tex_tpa.erf"):  # GUI pack first, it has the icons
        for k, v in erf_index(os.path.join(game, "TexturePacks", pack)).items():
            index.setdefault(k, v)
    override = os.path.join(game, "override")
    for f in os.listdir(override):
        name, ext = os.path.splitext(f.lower())
        if ext in (".tga", ".tpc"):  # override files win, as in game
            index[name] = (os.path.join(override, f), 0, os.path.getsize(os.path.join(override, f)), RES_TGA if ext == ".tga" else RES_TPC)

    missing = []
    for resref in sorted(wanted):
        hit = index.get(resref)
        if not hit:
            missing.append(resref)
            continue
        path, off, size, restype = hit
        with open(path, "rb") as fh:
            fh.seek(off)
            buf = fh.read(size)
        if restype == RES_TPC:
            img = decode_tpc(buf)
        else:
            from io import BytesIO
            img = Image.open(BytesIO(buf))
        img.convert("RGBA").save(os.path.join(out_dir, resref + ".png"), optimize=True)
    print(f"{len(wanted) - len(missing)} icons written to {out_dir}; missing: {missing or 'none'}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
