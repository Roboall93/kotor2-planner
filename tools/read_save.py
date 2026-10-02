"""Dump the player character's build-relevant stats from a KOTOR2 save.

Usage: python tools/read_save.py "<save folder>"

Used to calibrate the planner's formulas (HP, FP, saves, skills) against the
real engine. Reads SAVEGAME.sav (ERF) -> nested <module>.sav -> module.ifo.
"""
import struct
import sys


def read_erf(data):
    count, off_keys, off_res = struct.unpack_from("<I4xII", data, 16)
    entries = {}
    for i in range(count):
        resref = data[off_keys + i * 24:off_keys + i * 24 + 16].rstrip(b"\0").decode("ascii").lower()
        restype = struct.unpack_from("<H", data, off_keys + i * 24 + 20)[0]
        off, size = struct.unpack_from("<II", data, off_res + i * 8)
        entries[(resref, restype)] = data[off:off + size]
    return entries


class Gff:
    def __init__(self, data):
        self.d = data
        h = struct.unpack_from("<12I", data, 8)
        self.so, _, self.fo, _, self.lo, _, self.fdo, _, self.fio, _, self.lio, _ = h

    def label(self, i):
        return self.d[self.lo + i * 16:self.lo + i * 16 + 16].rstrip(b"\0").decode("ascii")

    def struct(self, idx):
        _t, data_off, n = struct.unpack_from("<3I", self.d, self.so + idx * 12)
        if n == 0:
            return {}
        if n == 1:
            idxs = [data_off]
        else:
            idxs = struct.unpack_from("<%dI" % n, self.d, self.fio + data_off)
        return {self.label(struct.unpack_from("<I", self.d, self.fo + f * 12 + 4)[0]): self.field(f) for f in idxs}

    def field(self, f):
        t, _lbl, v = struct.unpack_from("<3I", self.d, self.fo + f * 12)
        raw = self.d[self.fo + f * 12 + 8:self.fo + f * 12 + 12]
        fd = self.fdo + v
        if t in (0, 2, 4):
            return v
        if t == 1:
            return struct.unpack("<b", raw[:1])[0]
        if t == 3:
            return struct.unpack("<h", raw[:2])[0]
        if t == 5:
            return struct.unpack("<i", raw)[0]
        if t == 8:
            return struct.unpack("<f", raw)[0]
        if t in (6, 7):
            return struct.unpack_from("<q" if t == 7 else "<Q", self.d, fd)[0]
        if t == 9:
            return struct.unpack_from("<d", self.d, fd)[0]
        if t == 10:
            n = struct.unpack_from("<I", self.d, fd)[0]
            return self.d[fd + 4:fd + 4 + n].decode("cp1252")
        if t == 11:
            n = self.d[fd]
            return self.d[fd + 1:fd + 1 + n].decode("cp1252")
        if t == 14:
            return self.struct(v)
        if t == 15:
            n = struct.unpack_from("<I", self.d, self.lio + v)[0]
            return [self.struct(i) for i in struct.unpack_from("<%dI" % n, self.d, self.lio + v + 4)]
        return None  # locstring/void/vector: not needed here


def main(folder):
    top = read_erf(open(folder + "/SAVEGAME.sav", "rb").read())
    for (name, rtype), buf in top.items():
        if rtype != 2057:  # nested module .sav
            continue
        inner = read_erf(buf)
        ifo = inner.get(("module", 2014))
        if not ifo:
            continue
        mod = Gff(ifo).struct(0)
        for pc in mod.get("Mod_PlayerList", []):
            keep = ["FirstName", "Str", "Dex", "Con", "Int", "Wis", "Cha", "HitPoints", "MaxHitPoints",
                    "CurrentHitPoints", "ForcePoints", "MaxForcePoints", "CurrentForce", "Experience",
                    "GoodEvil", "fortbonus", "refbonus", "willbonus", "NaturalAC", "SkillPoints"]
            print("module:", name)
            print({k: pc.get(k) for k in keep if k in pc})
            for c in pc.get("ClassList", []):
                powers = [p.get("Spell") for lvl in c.get("KnownList0", []) for p in [lvl]]
                print("class", c.get("Class"), "level", c.get("ClassLevel"), "powers", powers)
            print("skills", [s.get("Rank") for s in pc.get("SkillList", [])])
            print("feats", [f.get("Feat") for f in pc.get("FeatList", [])])
            print("levelstats", [{k: l.get(k) for k in ("LvlStatClass", "LvlStatHitDie", "SkillPoints", "LvlStatAbility")}
                                 for l in pc.get("LvlStatList", [])])


if __name__ == "__main__":
    main(sys.argv[1])
