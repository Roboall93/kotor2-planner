"""Turn extracted 2DA JSON into the compact rules file the web app loads.

Usage: python tools/build_rules.py <raw dir> <out json> [k2|k1]
  python tools/build_rules.py raw    app/src/data/k2.json k2
  python tools/build_rules.py raw-k1 app/src/data/k1.json k1

Only the player's classes are included (KOTOR II: Jedi and prestige classes;
KOTOR I: the three starting classes and the three Jedi classes). Rules the
engines hardcode (not in 2DAs) live in src/games.ts with how they were verified.
"""
import json
import os
import re
import sys

# classes.2da row -> short codes used by the per-class columns in other tables.
# feat/skill/featgain use 3-letter codes; spells.2da uses long names (None = no
# Force powers); acbonus uses its own. "kind": start = a class you can begin as,
# jedi = KOTOR I's Jedi training class, prestige = KOTOR II prestige class.
GAMES = {
    "k2": {
        "levels": 50,
        "classes": [
            # row, code, spells col, acbonus col, kind, side
            (3, "jgd", "guardian", "jdg", "start", None),
            (4, "jcn", "consular", "jdc", "start", None),
            (5, "jsn", "sentinel", "jds", "start", None),
            (11, "jwm", "weapmstr", "jwm", "prestige", "light"),
            (12, "jma", "jedimaster", "jma", "prestige", "light"),
            (13, "jwa", "watchman", "jwa", "prestige", "light"),
            (14, "sma", "marauder", "sma", "prestige", "dark"),
            (15, "sld", "sithlord", "sld", "prestige", "dark"),
            (16, "sas", "assassin", "sas", "prestige", "dark"),
        ],
    },
    "k1": {
        "levels": 20,
        "classes": [
            (0, "sol", None, "sol", "start", None),
            (1, "sct", None, "sct", "start", None),
            (2, "scd", None, "scd", "start", None),
            (3, "jgd", "guardian", "jdg", "jedi", None),
            (4, "jcn", "consular", "jdc", "jedi", None),
            (5, "jsn", "sentinel", "jds", "jedi", None),
        ],
    },
}


# KOTOR II prestige powers the engine grants on its own (not in any 2DA). Class levels
# are from each power's in-game description ("Prerequisites: Level 5 Sith Lord ...").
POWER_GRANTS = {
    "jma": [(1, 167), (5, 168), (9, 169), (13, 170), (17, 171), (21, 172)],  # Inspire Followers I-VI
    "sld": [(1, 144), (5, 145), (9, 146), (13, 147), (17, 148), (21, 149)],  # Crush Opposition I-VI
    "sma": [(1, 164), (5, 165), (9, 166)],  # Fury, Improved, Master
    "jwa": [(1, 156), (7, 157), (13, 158)],  # Force Camouflage, Improved, Master
    "sas": [(1, 156), (7, 157), (13, 158)],
}
# KOTOR II story feats the Exile always has; no class lists them, so keep them explicitly.
STORY_FEATS = {206}  # War Veteran (+25 vitality)
GRANTED_POWERS = {pid for grants in POWER_GRANTS.values() for _, pid in grants}


def load(raw, name):
    with open(os.path.join(raw, name + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


def power_save(desc):
    """Save DC from a power's description: {"type", "base", "scales"} or None.

    Most read "DC of 5 + the attacking character's level + ... Wisdom and Charisma
    modifiers"; Force Scream uses 10 +, Affliction a flat 20, Plague 100 (no save).
    Defensive powers (Force Resistance/Immunity) quote the *defender's* level: skipped.
    """
    d = " ".join(desc.split())
    m = re.search(r"DC (?:of )?(\d+)( \+ the (attacking character|attacker|defending character)'s level)?", d)
    if not m or m.group(3) == "defending character":
        return None
    kind = re.search(r"(Fortitude|Reflex|Will) sav", d)
    return {"type": kind.group(1) if kind else None, "base": int(m.group(1)), "scales": bool(m.group(2))}


def num(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def main(raw, out, game="k2"):
    cfg = GAMES[game]
    CLASSES = cfg["classes"]
    LEVELS = cfg["levels"]
    story = STORY_FEATS if game == "k2" else set()
    grants = POWER_GRANTS if game == "k2" else {}
    granted_powers = GRANTED_POWERS if game == "k2" else set()
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
    for row, code, spellcol, accol, kind, side in CLASSES:
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
            "prestige": kind == "prestige",
            "jedi": kind == "jedi",
            "forceUser": spellcol is not None,
            "side": side,
            # index = class level - 1
            "bab": [num(list(x.values())[1]) for x in atk][:LEVELS],
            "fort": [num(x["fortsave"]) for x in saves][:LEVELS],
            "ref": [num(x["refsave"]) for x in saves][:LEVELS],
            "will": [num(x["willsave"]) for x in saves][:LEVELS],
            "featPicks": [num(x[code + "_reg"]) + num(x[code + "_bon"]) for x in featgain][:LEVELS],
            "powerPicks": [num(x.get(code)) for x in powergain][:LEVELS],
            # acbonus.2da has one more row than levels, indexed by class level (row 0 =
            # level 0), unlike the other progression tables; matches StrategyWiki.
            "classDefense": [num(x[accol]) for x in acbonus][:LEVELS + 1],
            "classSkills": [i for i, s in enumerate(skills_2da) if s.get(code + "_class") == "1"],
            "powerGrants": [list(g) for g in grants.get(code, [])],
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
        if not per and num(r["_label"]) not in story:
            continue
        feats.append({
            "id": num(r["_label"]),
            "name": name,
            "description": text(r["description"]),
            "minLevel": num(r["mincharlevel"]),
            "prereqs": [num(p) for p in (r["prereqfeat1"], r["prereqfeat2"]) if p],
            "successor": num(r["successor"], -1),
            "icon": (r["icon"] or "").lower() or None,
            "classes": per,
        })

    powers = []
    for r in load(raw, "spells"):
        name = text(r["name"])
        if not name or r["usertype"] != "1":
            continue
        per = {}
        for _row, code, col, *_ in CLASSES:
            lvl = num(r.get(col), -1) if col else -1
            # Granted powers aren't selectable (spells.2da marks Crush Opposition I as if it were).
            if lvl >= 0 and num(r["_label"]) not in granted_powers:
                per[code] = max(lvl, 1)
        if not per and num(r["_label"]) not in granted_powers:
            continue
        powers.append({
            "id": num(r["_label"]),
            "name": name,
            "description": text(r["spelldesc"]),
            "cost": num(r["forcepoints"]),
            "side": {"G": "light", "E": "dark"}.get(r["goodevil"], "universal"),
            "icon": (r["iconresref"] or "").lower() or None,
            "save": power_save(text(r["spelldesc"])),
            "prereqs": [num(p) for p in (r["prerequisites"] or "").split("_") if p],
            "classes": per,
        })

    rules = {
        "game": game,
        "source": f"Extracted from {'KOTOR II' if game == 'k2' else 'KOTOR I'} (Steam) 2DA tables",
        "xp": [num(r["xp"]) for r in load(raw, "exptable")][:LEVELS],
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
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "k2")
