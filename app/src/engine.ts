import rulesJson from './data/rules.json'

export interface ClassDef {
  id: string
  name: string
  description: string
  hitDie: number
  forceDie: number
  skillPointBase: number
  prestigeOf: string | null
  side: 'light' | 'dark' | null
  bab: number[]
  fort: number[]
  ref: number[]
  will: number[]
  featPicks: number[]
  powerPicks: number[]
  classDefense: number[]
  classSkills: number[]
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
export const POINT_BUY = 30
export const MAX_LEVEL = 50
export const PRESTIGE_MIN_LEVEL = 15
const WAR_VETERAN_HP = 25
const FORCE_SENSITIVE_FP = 40
const FORCE_SENSITIVE_LEVEL = 2
// Feats the Exile always has that are story-granted rather than class-granted.
const EXILE_FEATS = [206] // War Veteran

export const BASE_CLASSES = rules.classes.filter((c) => !c.prestigeOf)
export const prestigeOptions = (base: string) => rules.classes.filter((c) => c.prestigeOf === base)

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
  ownedFeats: Set<number>
  ownedPowers: Set<number>
  ranks: number[]
  hp: number
  fp: number
  bab: number
  fort: number
  ref: number
  will: number
  defense: number
  issues: string[]
}

export const classAt = (b: Build, level: number) =>
  b.prestige && level >= b.prestigeAt ? classById[b.prestige] : classById[b.base]

export const isClassSkill = (cls: ClassDef, skill: number) => cls.classSkills.includes(skill)
export const rankCap = (cls: ClassDef, skill: number, level: number) =>
  isClassSkill(cls, skill) ? level + 3 : Math.floor((level + 3) / 2)

/** Walks the build level by level, applying choices and validating them against the rules. */
export function simulate(b: Build): LevelState[] {
  const out: LevelState[] = []
  const classLevels: Record<string, number> = {}
  const attrs = { ...b.attrs }
  const owned = new Set<number>(EXILE_FEATS)
  const powers = new Set<number>()
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
      else issues.push('Attribute increase not assigned')
    } else if (choice.attr) issues.push('Attribute increases only come every 4 levels')

    const granted = rules.feats
      .filter((f) => f.classes[cls.id]?.grant === classLevel && !owned.has(f.id))
      .map((f) => f.id)
    granted.forEach((f) => owned.add(f))

    const featPicks = cls.featPicks[classLevel - 1] ?? 0
    if (choice.feats.length > featPicks) issues.push(`Too many feats (${choice.feats.length}/${featPicks})`)
    for (const id of choice.feats) {
      const why = featBlocked(id, cls, level, owned)
      if (why) issues.push(`${featById.get(id)?.name}: ${why}`)
      owned.add(id)
    }
    if (choice.feats.length < featPicks) issues.push(`${featPicks - choice.feats.length} feat pick(s) unspent`)

    const powerPicks = level === 1 ? 0 : (cls.powerPicks[classLevel - 1] ?? 0)
    if (choice.powers.length > powerPicks) issues.push(`Too many powers (${choice.powers.length}/${powerPicks})`)
    for (const id of choice.powers) {
      const why = powerBlocked(id, cls, level, powers)
      if (why) issues.push(`${powerById.get(id)?.name}: ${why}`)
      powers.add(id)
    }
    if (choice.powers.length < powerPicks) issues.push(`${powerPicks - choice.powers.length} power pick(s) unspent`)

    const skillPoints = Math.max(1, cls.skillPointBase + mod(attrs.int)) * (level === 1 ? 4 : 1)
    let spent = 0
    choice.skills.forEach((pts, s) => {
      if (!pts) return
      const cost = isClassSkill(cls, s) ? 1 : 2
      ranks[s] += Math.floor(pts / cost)
      spent += pts
      if (pts % cost) issues.push(`${rules.skills[s].name}: cross-class ranks cost 2 points`)
      if (ranks[s] > rankCap(cls, s, level)) issues.push(`${rules.skills[s].name}: rank ${ranks[s]} exceeds cap ${rankCap(cls, s, level)}`)
    })
    if (spent > skillPoints) issues.push(`Overspent skill points (${spent}/${skillPoints})`)

    hitDice += cls.hitDie
    if (level >= FORCE_SENSITIVE_LEVEL) forceDice += cls.forceDie
    const sum = (k: 'bab' | 'fort' | 'ref' | 'will' | 'classDefense') =>
      Object.entries(classLevels).reduce((t, [id, lv]) => t + (classById[id][k][lv - 1] ?? 0), 0)

    out.push({
      level, cls, classLevel, attrs: { ...attrs }, featPicks, powerPicks, skillPoints, skillPointsSpent: spent, granted,
      ownedFeats: new Set(owned), ownedPowers: new Set(powers), ranks: [...ranks],
      hp: hitDice + mod(attrs.con) * level + WAR_VETERAN_HP,
      fp: level >= FORCE_SENSITIVE_LEVEL ? forceDice + mod(attrs.wis) * (level - 1) + FORCE_SENSITIVE_FP : 0,
      bab: sum('bab'),
      fort: sum('fort') + mod(attrs.con),
      ref: sum('ref') + mod(attrs.dex),
      will: sum('will') + mod(attrs.wis),
      defense: 10 + mod(attrs.dex) + sum('classDefense'),
      issues,
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
