"""Extract 2DA rule tables and referenced strings from a KOTOR2 install.

Usage: python tools/extract_2da.py "<KOTOR2 install dir>" raw/

Reads chitin.key -> 2DA.bif, writes each 2DA as CSV-ish JSON (raw/<name>.json),
lets files in override/ win, and dumps dialog.tlk to raw/tlk.json.
"""
import json
import os
import struct
import sys

RES_2DA = 2017


def read_key(path):
    data = open(path, "rb").read()
    assert data[:8] == b"KEY V1  ", "not a KEY file"
    bif_count, key_count, off_files, off_keys = struct.unpack_from("<4I", data, 8)
    bifs = []
    for i in range(bif_count):
        _size, name_off, name_size, _drives = struct.unpack_from("<IIHH", data, off_files + i * 12)
        name = data[name_off:name_off + name_size].rstrip(b"\0").decode("ascii")
        bifs.append(name.replace("\\", "/"))
    keys = []
    for i in range(key_count):
        o = off_keys + i * 22
        resref = data[o:o + 16].rstrip(b"\0").decode("ascii").lower()
        restype, resid = struct.unpack_from("<HI", data, o + 16)
        keys.append((resref, restype, resid >> 20, resid & 0xFFFFF))
    return bifs, keys


def read_bif_resources(path):
    data = open(path, "rb").read()
    assert data[:8] == b"BIFFV1  ", "not a BIF file"
    var_count, _fixed, off = struct.unpack_from("<3I", data, 8)
    out = {}
    for i in range(var_count):
        rid, roff, rsize, _rtype = struct.unpack_from("<4I", data, off + i * 16)
        out[rid & 0xFFFFF] = data[roff:roff + rsize]
    return out


def parse_2da(buf):
    if buf.startswith(b"2DA V2.b"):
        p = buf.index(b"\n") + 1
        end = buf.index(b"\0", p)
        cols = buf[p:end].decode("latin-1").split("\t")[:-1]
        p = end + 1
        (rows,) = struct.unpack_from("<I", buf, p)
        p += 4
        labels = []
        for _ in range(rows):
            t = buf.index(b"\t", p)
            labels.append(buf[p:t].decode("latin-1"))
            p = t + 1
        n = rows * len(cols)
        offs = struct.unpack_from("<%dH" % n, buf, p)
        p += n * 2 + 2  # skip data-size field
        table = []
        for r in range(rows):
            row = {"_label": labels[r]}
            for c, col in enumerate(cols):
                s = buf[p + offs[r * len(cols) + c]:buf.index(b"\0", p + offs[r * len(cols) + c])]
                v = s.decode("latin-1")
                row[col.lower()] = None if v in ("", "****") else v
            table.append(row)
        return table
    # text 2DA (override files may be text)
    lines = [l for l in buf.decode("latin-1").splitlines()]
    cols = lines[2].split()
    table = []
    for line in lines[3:]:
        parts = _split_text_row(line)
        if not parts:
            continue
        row = {"_label": parts[0]}
        for c, col in enumerate(cols):
            v = parts[c + 1] if c + 1 < len(parts) else "****"
            row[col.lower()] = None if v == "****" else v
        table.append(row)
    return table


def _split_text_row(line):
    out, cur, q = [], "", False
    for ch in line:
        if ch == '"':
            q = not q
        elif ch.isspace() and not q:
            if cur:
                out.append(cur)
                cur = ""
        else:
            cur += ch
    if cur:
        out.append(cur)
    return out


def read_tlk(path):
    data = open(path, "rb").read()
    assert data[:8] == b"TLK V3.0"
    _lang, count, str_off = struct.unpack_from("<3I", data, 8)
    out = []
    for i in range(count):
        o = 20 + i * 40
        flags = struct.unpack_from("<I", data, o)[0]
        soff, ssize = struct.unpack_from("<II", data, o + 28)
        if flags & 1 and ssize:
            out.append(data[str_off + soff:str_off + soff + ssize].decode("cp1252", "replace"))
        else:
            out.append("")
    return out


def main(game, outdir):
    os.makedirs(outdir, exist_ok=True)
    bifs, keys = read_key(os.path.join(game, "chitin.key"))
    cache = {}
    tables = {}
    for resref, restype, bif_idx, res_idx in keys:
        if restype != RES_2DA:
            continue
        if bif_idx not in cache:
            cache[bif_idx] = read_bif_resources(os.path.join(game, bifs[bif_idx]))
        tables[resref] = cache[bif_idx][res_idx]
    override = os.path.join(game, "override")
    for f in os.listdir(override) if os.path.isdir(override) else []:
        if f.lower().endswith(".2da"):
            tables[f[:-4].lower()] = open(os.path.join(override, f), "rb").read()
            print("override:", f)
    for name, buf in tables.items():
        with open(os.path.join(outdir, name + ".json"), "w", encoding="utf-8") as fh:
            json.dump(parse_2da(buf), fh, indent=1)
    tlk = read_tlk(os.path.join(game, "dialog.tlk"))
    with open(os.path.join(outdir, "tlk.json"), "w", encoding="utf-8") as fh:
        json.dump(tlk, fh)
    print(f"{len(tables)} tables, {len(tlk)} strings")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
