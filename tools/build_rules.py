"""Turn extracted 2DA JSON (raw/) into the compact rules file the web app loads.

Usage: python tools/build_rules.py raw/ src/data/rules.json

Only player-relevant Jedi/Sith classes are included. Anything the engine
hardcodes (not in 2DAs) lives in src/engine.ts with a comment saying how it
was verified.
"""
import json
import os
import sys

# classes.2da row -> short codes used by the per-class columns in other tables.
# feat/skill/featgain use 3-letter codes; spells.2da uses long names; acbonus uses its own.
CLASSES = [
    # row, code, spells col, acbonus col, base class it upgrades from, side
    (3, "jgd", "guardian", "jdg", None, None),
    (4, "jcn", "consular", "jdc", None, None),
    (5, "jsn", "sentinel", "jds", None, None),
    (11, "jwm", "weapmstr", "jwm", "jgd", "light"),
    (12, "jma", "jedimaster", "jma", "jcn", "light"),
    (13, "jwa", "watchman", "jwa", "jsn", "light"),
    (14, "sma", "marauder", "sma", "jgd", "dark"),
    (15, "sld", "sithlord", "sld", "jcn", "dark"),
    (16, "sas", "assassin", "sas", "jsn", "dark"),
]


def load(raw, name):
    with open(os.path.join(raw, name + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


def num(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def main(raw, out):
    tlk = load(raw, "tlk")

    def text(strref):
        i = num(strref, -1)
        return tlk[i].strip() if 0 <= i < len(tlk) else ""

    classes_2da = load(raw, "classes")
    featgain = load(raw, "featgain")
    powergain = load(raw, "classpowergain")
    acbonus = load(raw, "acbonus")
    skills_2da = load(raw, "skills")

    classes = []
    for row, code, _spellcol, accol, base, side in CLASSES:
        r = classes_2da[row]
        atk = load(raw, r["attackbonustable"].lower())
        saves = load(raw, r["savingthrowtable"].lower())
        classes.append({
            "id": code,
            "row": row,
            "name": text(r["name"]),
            "description": text(r["description"]),
            "hitDie": num(r["hitdie"]),
            "forceDie": num(r["forcedie"]),
            "skillPointBase": num(r["skillpointbase"]),
            "prestigeOf": base,
            "side": side,
            # index = class level - 1
            "bab": [num(list(x.values())[1]) for x in atk][:50],
            "fort": [num(x["fortsave"]) for x in saves][:50],
            "ref": [num(x["refsave"]) for x in saves][:50],
            "will": [num(x["willsave"]) for x in saves][:50],
            "featPicks": [num(x[code + "_reg"]) + num(x[code + "_bon"]) for x in featgain][:50],
            "powerPicks": [num(x[code]) for x in powergain][:50],
            "classDefense": [num(x[accol]) for x in acbonus][:50],
            "classSkills": [i for i, s in enumerate(skills_2da) if s.get(code + "_class") == "1"],
        })

    skills = [{"id": i, "name": text(s["name"]), "ability": s["keyability"].lower(),
               "description": text(s["description"])} for i, s in enumerate(skills_2da)]

    feats = []
    for r in load(raw, "feat"):
        name = text(r["name"])
        if not name:
            continue
        per = {}
        for _row, code, *_ in CLASSES:
            lst = r.get(code + "_list")
            granted = num(r.get(code + "_granted"), -1)
            pc_granted = num(r.get(code + "_pc_granted"), -1)
            if lst in ("0", "1"):
                per[code] = {"pick": True}
            if lst == "3" and granted > 0:
                per[code] = {"grant": granted}
            if pc_granted > 0:
                per[code] = {"grant": pc_granted}
        if not per:
            continue
        feats.append({
            "id": num(r["_label"]),
            "name": name,
            "description": text(r["description"]),
            "minLevel": num(r["mincharlevel"]),
            "prereqs": [num(p) for p in (r["prereqfeat1"], r["prereqfeat2"]) if p],
            "successor": num(r["successor"], -1),
            "classes": per,
        })

    powers = []
    for r in load(raw, "spells"):
        name = text(r["name"])
        if not name or r["usertype"] != "1":
            continue
        per = {}
        for _row, code, col, *_ in CLASSES:
            lvl = num(r.get(col), -1)
            if lvl >= 0:
                per[code] = max(lvl, 1)
        if not per:
            continue
        powers.append({
            "id": num(r["_label"]),
            "name": name,
            "description": text(r["spelldesc"]),
            "cost": num(r["forcepoints"]),
            "side": {"G": "light", "E": "dark"}.get(r["goodevil"], "universal"),
            "prereqs": [num(p) for p in (r["prerequisites"] or "").split("_") if p],
            "classes": per,
        })

    rules = {
        "source": "Extracted from KOTOR2 (Steam) 2DA tables",
        "xp": [num(r["xp"]) for r in load(raw, "exptable")][:50],
        "forceCost": [{"light": float(r["goodcost"]), "dark": float(r["evilcost"])} for r in load(raw, "forceadjust")],
        "classes": classes,
        "skills": skills,
        "feats": feats,
        "powers": powers,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rules, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(classes)} classes, {len(feats)} feats, {len(powers)} powers, {len(skills)} skills -> {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
