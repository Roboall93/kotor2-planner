# KOTOR Character Planner

Plan a KOTOR I or KOTOR II character level by level: attributes, feats, Force powers, skills, and the
prestige class (KOTOR II) or Jedi training (KOTOR I), with share links. A switcher in the header picks the game.

**Live site:** https://roboall93.github.io/kotor2-planner/ (deployed by `.github/workflows/pages.yml` on every push to `main`).

Fan-made and non-commercial; not affiliated with Lucasfilm, Disney, Obsidian or Aspyr. Feat and Force power icons
and descriptions come from the game and remain © Lucasfilm Ltd.

## Layout

- `tools/extract_2da.py` reads `chitin.key` / `2DA.bif` / `patch.erf` / `dialog.tlk` from an install into
  `raw/` (KOTOR II) or `raw-k1/` (KOTOR I), both gitignored.
- `tools/build_rules.py` trims that into `app/src/data/k2.json` / `k1.json`, the only game data the site ships.
- `app/src/engine.ts` holds the rules engine; `GAMES` there lists everything that differs between the games.
- `tools/read_save.py` dumps the PC's stats from a save, used to check the engine's formulas.
- `tools/extract_icons.py` writes the feat/power icons the rules use to `app/public/icons` (Lucasfilm artwork,
  kept in its own folder: delete it and the app falls back to text).
- `tools/compare_wiki.py` cross-checks the rules against a StrategyWiki data workbook (needs `openpyxl`).
- `app/` is a Vite + React + TypeScript static site. `app/src/engine.ts` holds the rules engine.

```bash
python tools/extract_2da.py "E:/SteamLibrary/steamapps/common/Knights of the Old Republic II" raw
python tools/build_rules.py raw app/src/data/k2.json k2
python tools/extract_2da.py "E:/SteamLibrary/steamapps/common/swkotor" raw-k1
python tools/build_rules.py raw-k1 app/src/data/k1.json k1
npm --prefix app install
npm --prefix app run dev
```

## Rules status

### KOTOR I

Verified against real saves (Soldier 1; Scoundrel 7 / Jedi Guardian 4, rebuilt level by level from the
save's level history with identical vitality, Force, skill ranks, banked points and granted feats) and a
Soldier 2 character sheet:
- Vitality = sum of hit dice + CON mod × level (+ Toughness)
- Force = (force die + WIS mod + CHA mod) per Jedi level, + 40 (Force Sensitive, granted at Jedi level 1)
- Skill points: classes.2da lists double the real base. Creation (base/2 + INT mod) × 4, minimum 4;
  each level-up base/2 + half the INT mod rounded down, minimum 1 (matches the KOTOR wiki's table)
- Force powers from the first Jedi level (classpowergain.2da); attack bonus per class (CLS_ATK_1/2)
- Skills that were class skills for your starting class stay class skills after Jedi training
- Every character starts as Soldier/Scout/Scoundrel and becomes a Jedi at training. Taris usually tops out at level 8
  (9 at most), so the first Jedi level is usually the 9th and the 10th at the latest (planner default 9)

Not yet verified for KOTOR I: whether Charisma reduces opposite-alignment Force costs (only applied in KOTOR II),
and whether the old class can still be levelled after Jedi training (the planner assumes not).

### KOTOR II

Verified against real saves (Jedi Sentinel, levels 3–8):
- Vitality = sum of hit dice + CON mod × level + 25 (War Veteran)
- Force = (force die + WIS mod) per level from level 2, + 40 (Force Sensitive)
- Skill points = max(1, base + INT mod), ×4 at level 1; cross-class ranks cost 2
- Feat picks per class level (featgain.2da) and auto-granted feats (feat.2da)
- No Force power picks at level 1, then classpowergain.2da
- Unspent skill points carry over to later level-ups (confirmed by players; used to bank points for a prestige class)

Agrees with StrategyWiki (via `compare_wiki.py`): vitality/Force per level, saves at every level,
class skills, feat and power pick levels, power unlock levels (character level), class Defense
bonus (acbonus.2da rows start at level 0), and Force power costs by alignment and Charisma
(computed in 32-bit floats and truncated, as the game does).

Still unverified:
- Base attack bonus: classes.2da gives every class the full table
- Prestige classes: must already be level 15 (so the first prestige level is 16) and alignment 75+/25- per StrategyWiki. The planner lets any base class take any
  prestige class; StrategyWiki pairs each base class with two
- Whether WIS increases apply to Force points retroactively
- Multiclass defense bonus (class bonuses are summed; the feat descriptions say so)
- Class Skill feats apply from the next level (assumes the level-up screen asks for skills before feats)
- Base-class skills stay class skills after taking a prestige class (confirmed for KOTOR I's Jedi training;
  assumed for KOTOR II since both games share the engine)
- Prestige power grants (Inspire Followers, Crush Opposition, Fury, Force Camouflage) use the class levels in their descriptions;
  StrategyWiki's progression tables put tier III at level 10 but its own power page says 9, as do the descriptions
- Feat effects (Caution/Gear Head/Empathy, Conditioning, Toughness) follow the in-game descriptions; higher tiers replace lower ones
