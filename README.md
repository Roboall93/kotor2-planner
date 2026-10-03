# KOTOR II Character Planner

Plan a Jedi Exile build level by level: attributes, feats, Force powers, skills and prestige class, with share links.

## Layout

- `tools/extract_2da.py` reads `chitin.key` / `2DA.bif` / `dialog.tlk` from a KOTOR2 install into `raw/` (gitignored).
- `tools/build_rules.py` trims that into `app/src/data/rules.json`, the only game data the site ships.
- `tools/read_save.py` dumps the PC's stats from a save, used to check the engine's formulas.
- `app/` is a Vite + React + TypeScript static site. `app/src/engine.ts` holds the rules engine.

```bash
python tools/extract_2da.py "E:/SteamLibrary/steamapps/common/Knights of the Old Republic II" raw
python tools/build_rules.py raw app/src/data/rules.json
npm --prefix app install
npm --prefix app run dev
```

## Rules status

Verified against real saves (Jedi Sentinel, levels 3–8):
- Vitality = sum of hit dice + CON mod × level + 25 (War Veteran)
- Force = (force die + WIS mod) per level from level 2, + 40 (Force Sensitive)
- Skill points = max(1, base + INT mod), ×4 at level 1; cross-class ranks cost 2
- Feat picks per class level (featgain.2da) and auto-granted feats (feat.2da)
- No Force power picks at level 1, then classpowergain.2da

Still unverified:
- Base attack bonus: classes.2da gives every class the full table
- Prestige classes: level 15 minimum and alignment requirement (any base class can take any prestige class)
- Whether unspent skill points carry over to the next level (the planner assumes not)
- Whether WIS increases apply to Force points retroactively
- Multiclass defense bonus (class bonuses are summed)
