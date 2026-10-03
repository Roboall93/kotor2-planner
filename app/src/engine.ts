import rulesJson from './data/rules.json'

export interface ClassDef {
  id: string
  name: string
  description: string
  hitDie: number
  forceDie: number
  skillPointBase: number
  prestige: boolean
  side: 'light' | 'dark' | null
  bab: number[]
  fort: number[]
  ref: number[]
  will: number[]
  featPicks: number[]
  powerPicks: number[]
  classDefense: number[]
  classSkills: number[]
  powerGrants: [number, number][] // [class level, power id] granted automatically
}
export interface FeatDef {
  id: number
  name: string
  description: string
  minLevel: number
  prereqs: number[]
  successor: number
  classes: Record<string, { pick?: boolean; grant?: number }>
}
export interface PowerDef {
  id: number
  name: string
  description: string
  cost: number
  side: 'light' | 'dark' | 'universal'
  prereqs: number[]
  classes: Record<string, number>
}
export interface SkillDef {
  id: number
  name: string
  ability: Attr
  description: string
}
interface Rules {
  xp: number[]
  forceCost: { light: number; dark: number }[]
  classes: ClassDef[]
  skills: SkillDef[]
  feats: FeatDef[]
  powers: PowerDef[]
}

export const rules = rulesJson as unknown as Rules
export const classById = Object.fromEntries(rules.classes.map((c) => [c.id, c])) as Record<string, ClassDef>
export const featById = new Map(rules.feats.map((f) => [f.id, f]))
export const powerById = new Map(rules.powers.map((p) => [p.id, p]))

export const ATTRS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Attr = (typeof ATTRS)[number]
export const ATTR_NAMES: Record<Attr, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
}

// --- Engine constants not stored in 2DAs ---------------------------------
// Verified against the user's Jedi Sentinel saves (levels 3-8):
//   vitality = sum(hit dice) + CON mod * level + 25 (War Veteran feat, Exile only)
//   force    = sum(force die + WIS mod) over levels 2+ , + 40 (Force Sensitive, granted at level 2)
//   skill points = max(1, base + INT mod), x4 at level 1; cross-class ranks cost 2
//   the Exile picks no Force powers at level 1 (classpowergain's level-1 row is skipped)
//   skill ranks never exceed level + 3 (cross-class: half); unspent points are not banked
export const POINT_BUY = 30
export const MAX_LEVEL = 50
export const PRESTIGE_MIN_LEVEL = 15
const WAR_VETERAN_HP = 25
const FORCE_SENSITIVE_FP = 40
const FORCE_SENSITIVE_LEVEL = 2
// Feats the Exile always has that are story-granted rather than class-granted.
export const EXILE_FEATS = [206] // War Veteran

export const BASE_CLASSES = rules.classes.filter((c) => !c.prestige)
// Any base class can take any prestige class; only alignment gates it in game.
export const PRESTIGE_CLASSES = rules.classes.filter((c) => c.prestige)

export const mod = (score: number) => Math.floor((score - 10) / 2)
export const pointCost = (score: number) => {
  // 1 point per step up to 14, 2 for 15-16, 3 for 17-18
  let cost = 0
  for (let s = 9; s <= score; s++) cost += s <= 14 ? 1 : s <= 16 ? 2 : 3
  return cost
}

export interface LevelChoice {
  feats: number[]
  powers: number[]
  skills: number[] // points spent per skill id this level
  attr?: Attr
}

export interface Build {
  name: string
  base: string
  prestige: string | null
  prestigeAt: number
  alignment: number // 0 = dark, 100 = light
  attrs: Record<Attr, number>
  levels: LevelChoice[] // index 0 = level 1
}

export const emptyLevel = (): LevelChoice => ({ feats: [], powers: [], skills: rules.skills.map(() => 0) })

export function newBuild(base = 'jgd'): Build {
  return {
    name: '',
    base,
    prestige: null,
    prestigeAt: PRESTIGE_MIN_LEVEL,
    alignment: 50,
    attrs: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    levels: Array.from({ length: 20 }, emptyLevel),
  }
}

export interface LevelState {
  level: number
  cls: ClassDef
  classLevel: number
  attrs: Record<Attr, number>
  featPicks: number
  powerPicks: number
  skillPoints: number
  skillPointsSpent: number
  granted: number[] // feats granted at this level
  grantedPowers: number[] // powers granted at this level
  ownedFeats: Set<number>
  ownedPowers: Set<number>
  ranks: number[]
  classSkills: boolean[] // class-skill status used when spending this level's points
  skillBonus: number[] // from Caution / Gear Head / Empathy chains
  hp: number
  fp: number
  bab: number
  fort: number
  ref: number
  will: number
  defense: number
  issues: string[] // rule violations
  openPicks: number // feat + power picks not made yet
}

export const classAt = (b: Build, level: number) =>
  b.prestige && level >= b.prestigeAt ? classById[b.prestige] : classById[b.base]

// --- Passive feat effects ---------------------------------------------------
// The engine hardcodes these; numbers are from the feats' in-game descriptions.
// Each chain's higher tier replaces the lower one rather than stacking.
const SKILL_FEATS = [
  { tiers: [7, 117, 118], skills: [1, 2], needsRank: true }, // Caution: Demolitions, Stealth
  { tiers: [12, 119, 120], skills: [5, 6, 0], needsRank: true }, // Gear Head: Repair, Security, Computer Use
  { tiers: [10, 121, 122], skills: [4, 3, 7], needsRank: false }, // Empathy: Persuade, Awareness, Treat Injury
]
const CONDITIONING = [13, 21, 22] // +1 / +2 / +3 to all saves
const TOUGHNESS = [84, 124] // each gives +1 vitality per level, retroactive (Improved Toughness adds none)
// "Class Skill: X" feats make a cross-class skill cost 1 point per rank.
const CLASS_SKILL_FEATS: Record<number, number> = { 184: 0, 185: 1, 186: 5, 187: 6, 188: 2, 189: 7 }

const tierOf = (tiers: number[], owned: Set<number>) => tiers.reduce((t, id, i) => (owned.has(id) ? i + 1 : t), 0)

/** Bonus to each skill from owned feats (needs >= 1 rank where the feat says so). */
export function featSkillBonus(owned: Set<number>, ranks: number[]): number[] {
  const bonus = rules.skills.map(() => 0)
  for (const chain of SKILL_FEATS) {
    const tier = tierOf(chain.tiers, owned)
    if (tier) chain.skills.forEach((sk) => { if (!chain.needsRank || ranks[sk] > 0) bonus[sk] += tier })
  }
  return bonus
}

/** Which skills count as class skills at a level: the class's own, plus any
 *  Class Skill feat owned before that level (the game asks for skills before feats). */
export const classSkillsFor = (cls: ClassDef, ownedBefore: Set<number>) =>
  rules.skills.map((sk) => cls.classSkills.includes(sk.id) ||
    Object.entries(CLASS_SKILL_FEATS).some(([feat, skill]) => skill === sk.id && ownedBefore.has(+feat)))

export const rankCap = (isClass: boolean, level: number) => (isClass ? level + 3 : Math.floor((level + 3) / 2))

/** Walks the build level by level, applying choices and validating them against the rules. */
export function simulate(b: Build): LevelState[] {
  const out: LevelState[] = []
  const classLevels: Record<string, number> = {}
  const attrs = { ...b.attrs }
  const owned = new Set<number>(EXILE_FEATS)
  const powers = new Set<number>()
  // Where each feat/power came from, so a repeat pick can say where the first one is.
  const featSource = new Map<number, string>(EXILE_FEATS.map((f) => [f, 'granted by story']))
  const powerSource = new Map<number, number>()
  const ranks = rules.skills.map(() => 0)
  let hitDice = 0
  let forceDice = 0

  b.levels.forEach((choice, i) => {
    const level = i + 1
    const cls = classAt(b, level)
    const classLevel = (classLevels[cls.id] = (classLevels[cls.id] ?? 0) + 1)
    const issues: string[] = []

    if (level % 4 === 0) {
      if (choice.attr) attrs[choice.attr]++
    } else if (choice.attr) issues.push('Attribute increases only come every 4 levels')

    const grantedNow = rules.feats.filter((f) => f.classes[cls.id]?.grant === classLevel)
    for (const f of grantedNow) {
      if (featSource.get(f.id)?.startsWith('taken')) {
        issues.push(`${f.name} is granted here but was ${featSource.get(f.id)}, so that pick is wasted`)
      }
    }
    const granted = grantedNow.filter((f) => !owned.has(f.id)).map((f) => f.id)
    granted.forEach((f) => { owned.add(f); featSource.set(f, `granted at level ${level}`) })

    const classSkills = classSkillsFor(cls, owned)
    const featPicks = cls.featPicks[classLevel - 1] ?? 0
    if (choice.feats.length > featPicks) issues.push(`Too many feats (${choice.feats.length}/${featPicks})`)
    for (const id of choice.feats) {
      const name = featById.get(id)?.name
      if (featSource.has(id)) {
        issues.push(`${name}: already ${featSource.get(id)}`)
        continue
      }
      const why = featBlocked(id, cls, level, owned)
      if (why) issues.push(`${name}: ${why}`)
      owned.add(id)
      featSource.set(id, `taken at level ${level}`)
    }

    const grantedPowers = cls.powerGrants.filter(([lv]) => lv === classLevel).map(([, id]) => id)
    for (const id of grantedPowers) {
      if (powers.has(id)) issues.push(`${powerById.get(id)?.name} is granted here but was taken at level ${powerSource.get(id)}`)
      powers.add(id)
      powerSource.set(id, level)
    }

    const powerPicks = level === 1 ? 0 : (cls.powerPicks[classLevel - 1] ?? 0)
    if (choice.powers.length > powerPicks) issues.push(`Too many powers (${choice.powers.length}/${powerPicks})`)
    for (const id of choice.powers) {
      const name = powerById.get(id)?.name
      if (powers.has(id)) {
        issues.push(`${name}: already taken at level ${powerSource.get(id)}`)
        continue
      }
      const why = powerBlocked(id, cls, level, powers)
      if (why) issues.push(`${name}: ${why}`)
      powers.add(id)
      powerSource.set(id, level)
    }

    const skillPoints = Math.max(1, cls.skillPointBase + mod(attrs.int)) * (level === 1 ? 4 : 1)
    let spent = 0
    choice.skills.forEach((pts, s) => {
      if (!pts) return
      const cost = classSkills[s] ? 1 : 2
      ranks[s] += Math.floor(pts / cost)
      spent += pts
      if (pts % cost) issues.push(`${rules.skills[s].name}: cross-class ranks cost 2 points`)
      const cap = rankCap(classSkills[s], level)
      if (ranks[s] > cap) issues.push(`${rules.skills[s].name}: rank ${ranks[s]} exceeds cap ${cap}`)
    })
    if (spent > skillPoints) issues.push(`Overspent skill points (${spent}/${skillPoints})`)

    hitDice += cls.hitDie
    if (level >= FORCE_SENSITIVE_LEVEL) forceDice += cls.forceDie
    const sum = (k: 'bab' | 'fort' | 'ref' | 'will' | 'classDefense') =>
      Object.entries(classLevels).reduce((t, [id, lv]) => t + (classById[id][k][lv - 1] ?? 0), 0)

    const saveBonus = tierOf(CONDITIONING, owned)
    const toughness = TOUGHNESS.filter((f) => owned.has(f)).length

    out.push({
      level, cls, classLevel, attrs: { ...attrs }, featPicks, powerPicks, skillPoints, skillPointsSpent: spent, granted, grantedPowers,
      ownedFeats: new Set(owned), ownedPowers: new Set(powers), ranks: [...ranks],
      classSkills, skillBonus: featSkillBonus(owned, ranks),
      hp: hitDice + (mod(attrs.con) + toughness) * level + WAR_VETERAN_HP,
      fp: level >= FORCE_SENSITIVE_LEVEL ? forceDice + mod(attrs.wis) * (level - 1) + FORCE_SENSITIVE_FP : 0,
      bab: sum('bab'),
      fort: sum('fort') + mod(attrs.con) + saveBonus,
      ref: sum('ref') + mod(attrs.dex) + saveBonus,
      will: sum('will') + mod(attrs.wis) + saveBonus,
      defense: 10 + mod(attrs.dex) + sum('classDefense'),
      issues,
      openPicks: Math.max(0, featPicks - choice.feats.length) + Math.max(0, powerPicks - choice.powers.length),
    })
  })
  return out
}

export function featBlocked(id: number, cls: ClassDef, level: number, owned: Set<number>): string | null {
  const f = featById.get(id)
  if (!f) return 'unknown feat'
  if (!f.classes[cls.id]?.pick) return `not available to ${cls.name}`
  if (f.minLevel && level < f.minLevel) return `requires level ${f.minLevel}`
  const missing = f.prereqs.filter((p) => !owned.has(p))
  if (missing.length) return `requires ${missing.map((p) => featById.get(p)?.name ?? p).join(', ')}`
  return null
}

export function powerBlocked(id: number, cls: ClassDef, level: number, owned: Set<number>): string | null {
  const p = powerById.get(id)
  if (!p) return 'unknown power'
  const min = p.classes[cls.id]
  if (min === undefined) return `not available to ${cls.name}`
  if (level < min) return `requires level ${min}`
  const missing = p.prereqs.filter((q) => !owned.has(q))
  if (missing.length) return `requires ${missing.map((q) => powerById.get(q)?.name ?? q).join(', ')}`
  return null
}

/** Force point cost after alignment adjustment (forceadjust.2da). */
export function powerCost(p: PowerDef, alignment: number) {
  if (p.side === 'universal') return p.cost
  const row = rules.forceCost[Math.min(10, Math.floor(alignment / 10))]
  return Math.round(p.cost * row[p.side])
}

// --- Share links ---------------------------------------------------------
// Compact positional encoding so links stay short enough for forum posts.
export function encodeBuild(b: Build): string {
  const data = [
    1, b.name, b.base, b.prestige ?? '', b.prestigeAt, b.alignment, ATTRS.map((a) => b.attrs[a]),
    b.levels.map((l) => [l.feats, l.powers, l.skills, l.attr ? ATTRS.indexOf(l.attr) : -1]),
  ]
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeBuild(s: string): Build | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    if (d[0] !== 1 || !classById[d[2]]) return null
    return {
      name: d[1], base: d[2], prestige: d[3] || null, prestigeAt: d[4], alignment: d[5],
      attrs: Object.fromEntries(ATTRS.map((a, i) => [a, d[6][i]])) as Record<Attr, number>,
      levels: d[7].map((l: [number[], number[], number[], number]) => ({
        feats: l[0], powers: l[1], skills: l[2], attr: l[3] >= 0 ? ATTRS[l[3]] : undefined,
      })),
    }
  } catch {
    return null
  }
}

// --- Stages ----------------------------------------------------------------
// A stage is a run of levels where class and INT can't change: stages start at
// level 1, at every attribute increase (4, 8, 12...) and at the prestige level.
// Picks inside a stage are planned together; the placer assigns each one to the
// earliest level where it is legal, so the per-level plan stays game-accurate.

export interface Stage { start: number; end: number }

export function stagesOf(b: Build): Stage[] {
  const n = b.levels.length
  const cuts = new Set([1])
  for (let l = 4; l <= n; l += 4) cuts.add(l)
  if (b.prestige && b.prestigeAt <= n) cuts.add(b.prestigeAt)
  const sorted = [...cuts].sort((x, y) => x - y)
  return sorted.map((start, i) => ({ start, end: (sorted[i + 1] ?? n + 1) - 1 }))
}

export const stageLevels = (st: Stage) => Array.from({ length: st.end - st.start + 1 }, (_, i) => st.start + i)

export type PickKind = 'feats' | 'powers'

/** Assigns picks to the stage's levels in order, earliest legal slot first. */
export function placePicks(kind: PickKind, picks: number[], st: Stage, states: LevelState[]) {
  const prev = states[st.start - 2]
  const owned = new Set<number>(kind === 'feats' ? (prev?.ownedFeats ?? EXILE_FEATS) : (prev?.ownedPowers ?? []))
  // Prerequisites go first: a pick that others in the batch build on must take
  // the earliest slot, or its dependents can run out of levels (e.g. Heal before
  // Shock would push Shock to the stage's last level and strand Force Lightning).
  const prereqsOf = (id: number) => (kind === 'feats' ? featById.get(id)?.prereqs : powerById.get(id)?.prereqs) ?? []
  const chainBelow = (id: number, seen = new Set<number>()): number =>
    Math.max(0, ...picks.filter((p) => !seen.has(p) && prereqsOf(p).includes(id))
      .map((p) => 1 + chainBelow(p, new Set([...seen, p]))))
  let pending = picks.filter((id) => !owned.has(id)).sort((x, y) => chainBelow(y) - chainBelow(x))
  const perLevel: number[][] = []
  for (const level of stageLevels(st)) {
    const s = states[level - 1]
    if (kind === 'feats') s.granted.forEach((g) => owned.add(g))
    const slots = kind === 'feats' ? s.featPicks : s.powerPicks
    const chosen: number[] = []
    for (const id of pending) {
      if (chosen.length >= slots) break
      const why = kind === 'feats' ? featBlocked(id, s.cls, level, owned) : powerBlocked(id, s.cls, level, owned)
      if (!why && !owned.has(id)) chosen.push(id)
    }
    pending = pending.filter((id) => !chosen.includes(id))
    chosen.forEach((id) => owned.add(id))
    perLevel.push(chosen)
  }
  return { perLevel, unplaced: pending }
}

/** Writes a stage's picks into the build. Picks that can't be placed legally go in
 *  the first free slot (or the last level) so they stay visible with a warning. */
export function setStagePicks(b: Build, kind: PickKind, picks: number[], st: Stage) {
  const states = simulate(b)
  const { perLevel, unplaced } = placePicks(kind, picks, st, states)
  stageLevels(st).forEach((level, i) => {
    const s = states[level - 1]
    const slots = kind === 'feats' ? s.featPicks : s.powerPicks
    while (unplaced.length && perLevel[i].length < slots) perLevel[i].push(unplaced.shift()!)
  })
  perLevel[perLevel.length - 1].push(...unplaced)
  stageLevels(st).forEach((level, i) => { b.levels[level - 1][kind] = perLevel[i] })
}

export const stagePicks = (b: Build, kind: PickKind, st: Stage) =>
  stageLevels(st).flatMap((level) => b.levels[level - 1][kind].map((id) => ({ id, level })))

/** Ranks gained per skill at a level (points / cost for the class at that level). */
export function rankGains(b: Build, states: LevelState[], level: number): number[] {
  const { classSkills } = states[level - 1]
  return b.levels[level - 1].skills.map((pts, s) => Math.floor(pts / (classSkills[s] ? 1 : 2)))
}

export const stageGains = (b: Build, states: LevelState[], st: Stage) =>
  stageLevels(st).reduce((acc, level) => {
    rankGains(b, states, level).forEach((g, s) => { acc[s] += g })
    return acc
  }, rules.skills.map(() => 0))

/** Spreads the stage's wanted rank gains over its levels, round-robin, within
 *  each level's point budget and rank cap. */
export function placeSkills(gains: number[], st: Stage, states: LevelState[]) {
  const ranks = [...(states[st.start - 2]?.ranks ?? rules.skills.map(() => 0))]
  const remaining = [...gains]
  const perLevel: number[][] = []
  let unspent = 0
  for (const level of stageLevels(st)) {
    const s = states[level - 1]
    let budget = s.skillPoints
    const pts = rules.skills.map(() => 0)
    for (let progress = true; progress;) {
      progress = false
      for (const sk of rules.skills) {
        const cost = s.classSkills[sk.id] ? 1 : 2
        if (remaining[sk.id] > 0 && ranks[sk.id] < rankCap(s.classSkills[sk.id], level) && cost <= budget) {
          ranks[sk.id]++
          remaining[sk.id]--
          pts[sk.id] += cost
          budget -= cost
          progress = true
        }
      }
    }
    unspent += budget
    perLevel.push(pts)
  }
  return { perLevel, ok: remaining.every((r) => r === 0), unspent }
}

/** Re-spreads every stage's skills after a change (INT, class, prestige level)
 *  moved budgets or caps. Wanted ranks per level come from the build before the
 *  change; a stage that no longer fits keeps its old points and gets flagged. */
export function reflowSkills(before: Build, after: Build) {
  const beforeStates = simulate(before)
  const zero = () => rules.skills.map(() => 0)
  for (const st of stagesOf(after)) {
    const states = simulate(after)
    const gains = stageLevels(st).reduce((acc, level) => {
      if (level <= before.levels.length) rankGains(before, beforeStates, level).forEach((g, s) => { acc[s] += g })
      return acc
    }, zero())
    const placed = placeSkills(gains, st, states)
    if (placed.ok) stageLevels(st).forEach((level, i) => { after.levels[level - 1].skills = placed.perLevel[i] })
  }
}
