# KOTOR II Character Planner

Plan a Jedi Exile build level by level: attributes, feats, Force powers, skills and prestige class, with share links.

**Live site:** https://roboall93.github.io/kotor2-planner/ (deployed by `.github/workflows/pages.yml` on every push to `main`).

Fan-made and non-commercial; not affiliated with Lucasfilm, Disney, Obsidian or Aspyr. Feat and Force power icons
and descriptions come from the game and remain © Lucasfilm Ltd.

## Layout

- `tools/extract_2da.py` reads `chitin.key` / `2DA.bif` / `dialog.tlk` from a KOTOR2 install into `raw/` (gitignored).
- `tools/build_rules.py` trims that into `app/src/data/rules.json`, the only game data the site ships.
- `tools/read_save.py` dumps the PC's stats from a save, used to check the engine's formulas.
- `tools/extract_icons.py` writes the feat/power icons the rules use to `app/public/icons` (Lucasfilm artwork,
  kept in its own folder: delete it and the app falls back to text).
- `tools/compare_wiki.py` cross-checks the rules against a StrategyWiki data workbook (needs `openpyxl`).
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

Agrees with StrategyWiki (via `compare_wiki.py`): vitality/Force per level, saves at every level,
class skills, feat and power pick levels, power unlock levels (character level), class Defense
bonus (acbonus.2da rows start at level 0), and Force power costs by alignment and Charisma
(computed in 32-bit floats and truncated, as the game does).

Still unverified:
- Base attack bonus: classes.2da gives every class the full table
- Prestige classes: must already be level 15 (so the first prestige level is 16) and alignment 75+/25- per StrategyWiki. The planner lets any base class take any
  prestige class; StrategyWiki pairs each base class with two
- Whether unspent skill points carry over to the next level (the planner assumes not)
- Whether WIS increases apply to Force points retroactively
- Multiclass defense bonus (class bonuses are summed; the feat descriptions say so)
- Class Skill feats apply from the next level (assumes the level-up screen asks for skills before feats)
- Prestige power grants (Inspire Followers, Crush Opposition, Fury, Force Camouflage) use the class levels in their descriptions;
  StrategyWiki's progression tables put tier III at level 10 but its own power page says 9, as do the descriptions
- Feat effects (Caution/Gear Head/Empathy, Conditioning, Toughness) follow the in-game descriptions; higher tiers replace lower ones
