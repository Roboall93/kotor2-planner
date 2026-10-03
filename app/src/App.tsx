import { useEffect, useMemo, useState } from 'react'
import {
  ATTRS, ATTR_NAMES, BASE_CLASSES, MAX_LEVEL, POINT_BUY, PRESTIGE_CLASSES, PRESTIGE_MIN_LEVEL,
  classById, decodeBuild, emptyLevel, encodeBuild, featById, mod, newBuild,
  placePicks, placeSkills, pointCost, powerById, powerCost, prestigeAlignmentOk, reflowSkills, rules, setStagePicks, simulate,
  stageGains, stageLevels, stagePicks, stagesOf,
  type Attr, type Build, type LevelState, type PickKind, type Stage,
} from './engine'
import './App.css'

const STORAGE_KEY = 'kotor2-planner-build'

function loadInitial(): Build {
  const fromHash = location.hash.startsWith('#b=') ? decodeBuild(location.hash.slice(3)) : null
  if (fromHash) return fromHash
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const b = saved ? decodeBuild(saved) : null
    if (b) return b
  } catch { /* storage unavailable */ }
  return newBuild()
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`)
const range = (st: Stage) => (st.start === st.end ? `Level ${st.start}` : `Levels ${st.start}–${st.end}`)

type Updater = (fn: (b: Build) => void, opts?: { reflow?: boolean }) => void

export default function App() {
  const [build, setBuild] = useState<Build>(loadInitial)
  const [openStage, setOpenStage] = useState(0)
  const [copied, setCopied] = useState(false)
  const states = useMemo(() => simulate(build), [build])
  const stages = useMemo(() => stagesOf(build), [build])
  const code = useMemo(() => encodeBuild(build), [build])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  }, [code])

  // reflow: the change can move skill budgets or caps (INT, class, prestige, level count),
  // so re-spread every stage's skill plan to keep it legal.
  const update: Updater = (fn, opts) =>
    setBuild((prev) => {
      const next = structuredClone(prev)
      fn(next)
      if (opts?.reflow) reflowSkills(prev, next)
      return next
    })

  const stageIdx = Math.min(openStage, stages.length - 1)
  const stage = stages[stageIdx]
  const spent = ATTRS.reduce((t, a) => t + pointCost(build.attrs[a]), 0)
  const totalIssues = states.reduce((t, s) => t + s.issues.length, 0)
  const totalOpen = states.reduce((t, s) => t + s.openPicks + (s.level % 4 === 0 && !build.levels[s.level - 1].attr ? 1 : 0), 0)
  const openLevel = (level: number) => setOpenStage(stages.findIndex((st) => level >= st.start && level <= st.end))

  const share = async () => {
    const url = `${location.origin}${location.pathname}#b=${code}`
    history.replaceState(null, '', url)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked; the link is still in the address bar */ }
  }

  const setLevelCount = (n: number) =>
    update((b) => {
      while (b.levels.length < n) b.levels.push(emptyLevel())
      b.levels.length = n
      if (n < PRESTIGE_MIN_LEVEL) b.prestige = null
      b.prestigeAt = Math.min(b.prestigeAt, Math.max(PRESTIGE_MIN_LEVEL, n))
    }, { reflow: true })

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>KOTOR II Character Planner</h1>
          <p className="sub">The Sith Lords · rules read from the game's own data tables</p>
        </div>
        <div className="top-actions">
          <input
            className="name"
            placeholder="Build name"
            value={build.name}
            onChange={(e) => update((b) => { b.name = e.target.value })}
          />
          <button className="primary" onClick={share}>{copied ? 'Link copied' : 'Copy share link'}</button>
          <button onClick={() => { if (confirm('Start a new build? The current one will be replaced.')) { setBuild(newBuild()); setOpenStage(0) } }}>New</button>
        </div>
      </header>

      <main className="layout">
        <section className="col setup">
          <div className="card">
            <h2>Class</h2>
            <div className="seg">
              {BASE_CLASSES.map((c) => (
                <button
                  key={c.id}
                  className={build.base === c.id ? 'on' : ''}
                  onClick={() => update((b) => { b.base = c.id }, { reflow: true })}
                >{c.name.replace('Jedi ', '')}</button>
              ))}
            </div>
            <p className="note">
              {classById[build.base].hitDie} vitality · {classById[build.base].forceDie} Force ·{' '}
              {classById[build.base].skillPointBase} skill points per level
            </p>
          </div>

          <div className="card">
            <h2>Attributes <span className={`pill ${spent > POINT_BUY ? 'bad' : ''}`}>{POINT_BUY - spent} points left</span></h2>
            {ATTRS.map((a) => (
              <div className="attr" key={a}>
                <span className="attr-name">{ATTR_NAMES[a]}</span>
                <button aria-label={`Lower ${ATTR_NAMES[a]}`} disabled={build.attrs[a] <= 8} onClick={() => update((b) => { b.attrs[a]-- }, { reflow: true })}>−</button>
                <span className="attr-val">{build.attrs[a]}</span>
                <button
                  aria-label={`Raise ${ATTR_NAMES[a]}`}
                  disabled={build.attrs[a] >= 18 || spent - pointCost(build.attrs[a]) + pointCost(build.attrs[a] + 1) > POINT_BUY}
                  onClick={() => update((b) => { b.attrs[a]++ }, { reflow: true })}
                >+</button>
                <span className="mod">{signed(mod(build.attrs[a]))}</span>
              </div>
            ))}
            <p className="note">Starting scores. 1 point per step up to 14, 2 for 15–16, 3 for 17–18.</p>
          </div>

          <div className="card">
            <h2>Prestige class</h2>
            <select
              value={build.prestige ?? ''}
              disabled={build.levels.length < PRESTIGE_MIN_LEVEL}
              onChange={(e) => update((b) => { b.prestige = e.target.value || null }, { reflow: true })}
            >
              <option value="">None</option>
              {PRESTIGE_CLASSES.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.side} side)</option>
              ))}
            </select>
            {build.prestige && (
              <label className="inline">
                Taken at level
                <input
                  type="number" min={PRESTIGE_MIN_LEVEL} max={build.levels.length} value={build.prestigeAt}
                  onChange={(e) => update((b) => {
                    b.prestigeAt = Math.max(PRESTIGE_MIN_LEVEL, Math.min(b.levels.length, +e.target.value || PRESTIGE_MIN_LEVEL))
                  }, { reflow: true })}
                />
              </label>
            )}
            <p className="note">
              {build.levels.length < PRESTIGE_MIN_LEVEL
                ? `Plan to level ${PRESTIGE_MIN_LEVEL}+ to unlock.`
                : `Available from level ${PRESTIGE_MIN_LEVEL} with alignment 75+ (light) or 25 or below (dark).`}
            </p>
            {build.prestige && !prestigeAlignmentOk(classById[build.prestige], build.alignment) && (
              <p className="note warn-text">
                {classById[build.prestige].name} needs {classById[build.prestige].side === 'light' ? '75 or higher' : '25 or lower'} alignment;
                the slider is at {build.alignment}.
              </p>
            )}
          </div>

          <div className="card">
            <h2>Alignment <span className="pill">{build.alignment}</span></h2>
            <input
              type="range" min={0} max={100} value={build.alignment} className="align" aria-label="Alignment"
              onChange={(e) => update((b) => { b.alignment = +e.target.value })}
            />
            <div className="align-labels"><span>Dark</span><span>Light</span></div>
            <p className="note">Adjusts light and dark power costs.</p>
          </div>

          <div className="card">
            <h2>Plan to level</h2>
            <input
              type="number" min={1} max={MAX_LEVEL} value={build.levels.length}
              onChange={(e) => setLevelCount(Math.max(1, Math.min(MAX_LEVEL, +e.target.value || 1)))}
            />
          </div>
        </section>

        <section className="col timeline">
          <h2 className="col-title">
            Level-up plan
            <span className="pills">
              {totalOpen > 0 && <span className="pill">{totalOpen} picks left</span>}
              <span className={`pill ${totalIssues ? 'warn' : 'ok'}`}>{totalIssues ? `${totalIssues} rule ${totalIssues === 1 ? 'error' : 'errors'}` : 'No rule errors'}</span>
            </span>
          </h2>

          <LevelStrip states={states} stage={stage} onPick={openLevel} />

          {stages.map((st, i) =>
            i === stageIdx ? (
              <StageCard key={st.start} stage={st} build={build} states={states} update={update} />
            ) : (
              <StageRow key={st.start} stage={st} build={build} states={states} onOpen={() => setOpenStage(i)} />
            ),
          )}
        </section>

        <section className="col summary">
          <Summary state={states[stage.end - 1]} before={states[stage.start - 2]} build={build} />
        </section>
      </main>

      <footer>
        Fan-made tool. Not affiliated with Lucasfilm, Obsidian or Aspyr. Values marked ? are not yet confirmed in game.
      </footer>
    </div>
  )
}

function LevelStrip({ states, stage, onPick }: { states: LevelState[]; stage: Stage; onPick: (level: number) => void }) {
  return (
    <div className="strip" role="list" aria-label="Levels">
      {states.map((s) => {
        const inStage = s.level >= stage.start && s.level <= stage.end
        return (
          <button
            key={s.level}
            role="listitem"
            className={`tick ${s.cls.prestige ? 'prestige' : ''} ${inStage ? 'current' : ''} ${s.issues.length ? 'issue' : ''} ${s.openPicks ? 'open-picks' : ''}`}
            title={`Level ${s.level} · ${s.cls.name} ${s.classLevel}${s.issues.length ? `\n${s.issues.join('\n')}` : ''}`}
            onClick={() => onPick(s.level)}
          >
            <span>{s.level % 4 === 0 || s.level === 1 ? s.level : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

function stageIssues(states: LevelState[], st: Stage) {
  return stageLevels(st).flatMap((l) => states[l - 1].issues.map((t) => ({ level: l, text: t })))
}

function classSpan(states: LevelState[], st: Stage) {
  const a = states[st.start - 1]
  const b = states[st.end - 1]
  return a.classLevel === b.classLevel ? `${a.cls.name} ${a.classLevel}` : `${a.cls.name} ${a.classLevel}–${b.classLevel}`
}

function StageRow({ stage: st, build, states, onOpen }: { stage: Stage; build: Build; states: LevelState[]; onOpen: () => void }) {
  const issues = stageIssues(states, st)
  const attr = build.levels[st.start - 1].attr
  return (
    <button className={`stage-row ${issues.length ? 'has-issues' : ''}`} onClick={onOpen}>
      <span className="range">{range(st)}</span>
      <span className="lv-class">{classSpan(states, st)}</span>
      <span className="lv-picks">
        {attr && <span className="chip attr">+1 {attr.toUpperCase()}</span>}
        {stagePicks(build, 'feats', st).map(({ id }) => <span key={`f${id}`} className="chip feat">{featById.get(id)?.name}</span>)}
        {stagePicks(build, 'powers', st).map(({ id }) => <span key={`p${id}`} className="chip power">{powerById.get(id)?.name}</span>)}
      </span>
      {issues.length > 0 && <span className="dot">{issues.length}</span>}
    </button>
  )
}

function StageCard({ stage: st, build, states, update }: { stage: Stage; build: Build; states: LevelState[]; update: Updater }) {
  const [detail, setDetail] = useState(false)
  const levels = stageLevels(st)
  const grantedNames = levels.flatMap((l) => [
    ...states[l - 1].granted.map((f) => `${featById.get(f)?.name} (${l})`),
    ...states[l - 1].grantedPowers.map((p) => `${powerById.get(p)?.name} (${l})`),
  ])
  const issues = stageIssues(states, st)
  const attrLevel = st.start % 4 === 0 ? st.start : null

  return (
    <div className="stage open">
      <div className="stage-head">
        <div>
          <h3>{range(st)}</h3>
          <span className="lv-class">{classSpan(states, st)}</span>
          {build.prestige && st.start === build.prestigeAt && <span className="pill gold">Prestige begins</span>}
        </div>
        <button className="link" onClick={() => setDetail(!detail)}>{detail ? 'Hide' : 'Show'} level by level</button>
      </div>

      {grantedNames.length > 0 && (
        <p className="granted">Granted automatically: {grantedNames.join(', ')}</p>
      )}

      {attrLevel && (
        <div className="field">
          <label>Attribute increase at level {attrLevel}</label>
          <div className="seg small">
            {ATTRS.map((a) => (
              <button
                key={a}
                className={build.levels[attrLevel - 1].attr === a ? 'on' : ''}
                onClick={() => update((b) => { b.levels[attrLevel - 1].attr = a as Attr }, { reflow: true })}
              >{a.toUpperCase()} <small>{states[attrLevel - 1].attrs[a] - (build.levels[attrLevel - 1].attr === a ? 1 : 0)}</small></button>
            ))}
          </div>
          {build.levels[attrLevel - 1].attr === 'int' && (
            <p className="note">Raises skill points from level {attrLevel} on, not before.</p>
          )}
        </div>
      )}

      <StagePicks kind="feats" stage={st} build={build} states={states} update={update} />
      <StagePicks kind="powers" stage={st} build={build} states={states} update={update} />
      {st.start === 1 && <p className="note">The Exile starts cut off from the Force, so level 1 has no power picks.</p>}
      <StageSkills stage={st} build={build} states={states} update={update} />

      {detail && <LevelDetail stage={st} build={build} states={states} />}

      {issues.length > 0 && (
        <ul className="issues">{issues.map((t, k) => <li key={k}><b>Lv {t.level}</b> {t.text}</li>)}</ul>
      )}
    </div>
  )
}

function StagePicks({ kind, stage: st, build, states, update }: {
  kind: PickKind; stage: Stage; build: Build; states: LevelState[]; update: Updater
}) {
  const isFeat = kind === 'feats'
  const cha = states[st.end - 1].attrs.cha
  const chosen = stagePicks(build, kind, st)
  const ids = chosen.map((c) => c.id)
  const slots = stageLevels(st).reduce((t, l) => t + (isFeat ? states[l - 1].featPicks : states[l - 1].powerPicks), 0)
  if (slots === 0 && chosen.length === 0) return null

  // Anything picked anywhere in the build is excluded, so a later stage's pick
  // can't be taken again here.
  const pickedAnywhere = new Set(build.levels.flatMap((l) => l[kind]))
  const before = states[st.start - 2]
  const ownedBefore = isFeat ? before?.ownedFeats : before?.ownedPowers
  const all = isFeat ? rules.feats : rules.powers
  const options = chosen.length >= slots ? [] : all.filter((x) =>
    !pickedAnywhere.has(x.id) && !ownedBefore?.has(x.id) &&
    placePicks(kind, [...ids, x.id], st, states).unplaced.length === 0)

  const label = (id: number) => {
    if (isFeat) return featById.get(id)?.name ?? `#${id}`
    const p = powerById.get(id)
    return p ? `${p.name} (${p.side === 'universal' ? 'U' : p.side[0].toUpperCase()}, ${powerCost(p, build.alignment, cha)} FP)` : `#${id}`
  }
  const desc = (id: number) => (isFeat ? featById.get(id)?.description : powerById.get(id)?.description) ?? ''
  const set = (next: number[]) => update((b) => setStagePicks(b, kind, next, st))

  return (
    <div className="field">
      <label>{isFeat ? 'Feats' : 'Force powers'} <span className="count">{chosen.length} of {slots}</span></label>
      {chosen.length > 0 && (
        <div className="chosen">
          {chosen.map(({ id, level }) => (
            <details key={id} className="pick">
              <summary>
                <span className="lvl-tag">Lv {level}</span>
                <b>{label(id)}</b>
                <button aria-label={`Remove ${label(id)}`} onClick={(e) => { e.preventDefault(); set(ids.filter((x) => x !== id)) }}>×</button>
              </summary>
              <p>{desc(id)}</p>
            </details>
          ))}
        </div>
      )}
      {chosen.length < slots && (
        <select value="" onChange={(e) => e.target.value && set([...ids, +e.target.value])}>
          <option value="">{options.length ? `Add ${isFeat ? 'a feat' : 'a power'}…` : 'Nothing eligible in these levels'}</option>
          {[...options].sort((a, b) => a.name.localeCompare(b.name)).map((o) => (
            <option key={o.id} value={o.id}>{label(o.id)}</option>
          ))}
        </select>
      )}
    </div>
  )
}

function StageSkills({ stage: st, build, states, update }: { stage: Stage; build: Build; states: LevelState[]; update: Updater }) {
  const gains = stageGains(build, states, st)
  const budget = stageLevels(st).reduce((t, l) => t + states[l - 1].skillPoints, 0)
  const spentPts = stageLevels(st).reduce((t, l) => t + states[l - 1].skillPointsSpent, 0)
  const last = states[st.end - 1]
  const tryGains = (next: number[]) => placeSkills(next, st, states)
  const apply = (next: number[]) => {
    const placed = tryGains(next)
    if (placed.ok) update((b) => stageLevels(st).forEach((l, i) => { b.levels[l - 1].skills = placed.perLevel[i] }))
  }

  return (
    <div className="field">
      <label>Skills <span className="count">{spentPts} of {budget} points</span></label>
      <div className="skills">
        {rules.skills.map((sk) => {
          const cls = last.classSkills[sk.id]
          const plus = gains.map((g, s) => (s === sk.id ? g + 1 : g))
          const minus = gains.map((g, s) => (s === sk.id ? g - 1 : g))
          return (
            <div className="skill" key={sk.id} title={sk.description}>
              <span className={cls ? '' : 'cross'}>{sk.name}{!cls && <small> cross-class</small>}</span>
              <button aria-label={`Lower ${sk.name}`} disabled={gains[sk.id] <= 0} onClick={() => apply(minus)}>−</button>
              <span className="rank">{last.ranks[sk.id]}</span>
              <button aria-label={`Raise ${sk.name}`} disabled={!tryGains(plus).ok} onClick={() => apply(plus)}>+</button>
              <span className="mod">{gains[sk.id] > 0 ? `+${gains[sk.id]}` : ''}</span>
            </div>
          )
        })}
      </div>
      <p className="note">
        Ranks shown are at level {st.end}. Points are spent level by level, capped at level + 3
        ({Math.floor((st.end + 3) / 2)} for cross-class at level {st.end}).
      </p>
    </div>
  )
}

function LevelDetail({ stage: st, build, states }: { stage: Stage; build: Build; states: LevelState[] }) {
  return (
    <table className="detail">
      <thead><tr><th>Lv</th><th>Class</th><th>Feats</th><th>Powers</th><th>Skills</th></tr></thead>
      <tbody>
        {stageLevels(st).map((l) => {
          const s = states[l - 1]
          const c = build.levels[l - 1]
          const skills = c.skills.flatMap((pts, k) => (pts ? [`${rules.skills[k].name} ${pts}`] : []))
          const left = s.skillPoints - s.skillPointsSpent
          return (
            <tr key={l} className={s.issues.length ? 'bad' : ''}>
              <td>{l}</td>
              <td>{s.cls.name} {s.classLevel}{c.attr && <> · +1 {c.attr.toUpperCase()}</>}</td>
              <td>{c.feats.map((f) => featById.get(f)?.name).join(', ') || (s.featPicks ? '—' : '')}</td>
              <td>{c.powers.map((p) => powerById.get(p)?.name).join(', ') || (s.powerPicks ? '—' : '')}</td>
              <td>{skills.join(', ')}{left > 0 && <span className="muted"> ({left} unspent)</span>}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface Chained<T> { top: T; chain: T[] }

/** Powers: folds each prerequisite tree (Shock → Force Lightning → Force Storm)
 *  into its highest owned power, as the game's power screen does. */
function collapsePowerTrees<T extends { id: number; prereqs: number[] }>(items: T[], byId: Map<number, T>): Chained<T>[] {
  const owned = new Set(items.map((i) => i.id))
  const required = new Set(items.flatMap((i) => i.prereqs.filter((p) => owned.has(p))))
  const ancestors = (i: T, seen: Set<number>): T[] =>
    i.prereqs.flatMap((p) => {
      if (!owned.has(p) || seen.has(p)) return []
      seen.add(p)
      const parent = byId.get(p)!
      return [...ancestors(parent, seen), parent]
    })
  return items.filter((i) => !required.has(i.id)).map((top) => ({ top, chain: [...ancestors(top, new Set()), top] }))
}

// Feats: tiers share a name (Toughness / Improved / Master, Unarmed Specialist I–VIII).
// Prerequisites don't work here: Weapon Focus requires a proficiency that isn't a tier of it.
const TIER_PREFIX = /^(Improved|Advanced|Master|Greater|Superior) /
const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 }
const featFamily = (name: string) => name.replace(TIER_PREFIX, '').replace(/ (I|II|III|IV|V|VI|VII|VIII|IX|X)$/, '')
const featRank = (name: string) => {
  const prefix = ['Improved', 'Advanced', 'Master', 'Greater', 'Superior'].map((p) => name.startsWith(`${p} `))
  const tier = prefix[0] || prefix[1] ? 1 : prefix[2] || prefix[3] ? 2 : prefix[4] ? 3 : 0
  return (ROMAN[name.split(' ').pop()!] ?? 0) * 10 + tier
}
function collapseFeatTiers<T extends { name: string }>(items: T[]): Chained<T>[] {
  const families = new Map<string, T[]>()
  for (const i of items) families.set(featFamily(i.name), [...(families.get(featFamily(i.name)) ?? []), i])
  return [...families.values()].map((group) => {
    const chain = group.sort((a, b) => featRank(a.name) - featRank(b.name))
    return { top: chain[chain.length - 1], chain }
  })
}

const isProficiency = (name: string) => /^(Weapon|Armor) Proficiency/.test(name)
const profLabel = (name: string) =>
  name.startsWith('Armor') ? `${name.replace('Armor Proficiency: ', '')} Armor` : name.replace('Weapon Proficiency: ', '')
const GRANTED_POWERS = new Set(rules.classes.flatMap((c) => c.powerGrants.map(([, id]) => id)))
type Tab = 'stats' | 'feats' | 'powers'
type Entry = { id: number; name: string; description: string; prereqs: number[]; side?: string }

function Summary({ state: s, before, build }: { state: LevelState; before?: LevelState; build: Build }) {
  const [tab, setTab] = useState<Tab>('stats')
  const chosen = new Set(build.levels.slice(0, s.level).flatMap((l) => l.feats))
  const byName = (a: Chained<Entry>, b: Chained<Entry>) => a.top.name.localeCompare(b.top.name)

  const feats = collapseFeatTiers<Entry>([...s.ownedFeats].flatMap((id) => featById.get(id) ?? [])).sort(byName)
  const picked = feats.filter((c) => c.chain.some((f) => chosen.has(f.id)))
  const chosenOwned = [...chosen].filter((id) => s.ownedFeats.has(id)).length
  const profs = feats.filter((c) => !picked.includes(c) && isProficiency(c.top.name))
  const features = feats.filter((c) => !picked.includes(c) && !profs.includes(c))
  const powers = collapsePowerTrees<Entry>([...s.ownedPowers].flatMap((id) => powerById.get(id) ?? []), powerById).sort(byName)

  // "new" = gained somewhere in the open stage
  const isNew = (id: number, kind: 'feat' | 'power') =>
    !(kind === 'feat' ? before?.ownedFeats : before?.ownedPowers)?.has(id)

  const row = (c: Chained<Entry>, kind: 'feat' | 'power', extra?: React.ReactNode) => (
    <li key={c.top.id} title={`${c.chain.map((x) => x.name).join(' → ')}\n\n${c.top.description}`}>
      {kind === 'power' && <span className={`side ${c.top.side}`} />}
      <span className="nm">{c.top.name}</span>
      {c.chain.length > 1 && <span className="pips" aria-label={`${c.chain.length} tiers`}>{'●'.repeat(c.chain.length)}</span>}
      {c.chain.some((x) => isNew(x.id, kind)) && <span className="new">new</span>}
      {extra}
    </li>
  )

  return (
    <div className="card sticky">
      <h2>Character at level {s.level} <span className="lv-class">{s.cls.name} {s.classLevel}</span></h2>
      <div className="tabs" role="tablist">
        {([['stats', 'Stats'], ['feats', `Feats · ${chosenOwned} picked`], ['powers', `Powers · ${s.ownedPowers.size}`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'stats' && (
        <>
          <div className="stats">
            <Stat label="Vitality" value={s.hp} />
            <Stat label="Force" value={s.fp} />
            <Stat label="Defense" value={s.defense} flag="Base defense: 10 + DEX + class bonus, before armor and items." />
            <Stat label="Attack" value={signed(s.bab)} flag="Base attack bonus from classes.2da, which gives every class the full table. Not yet confirmed in game." />
            <Stat label="Fortitude" value={signed(s.fort)} />
            <Stat label="Reflex" value={signed(s.ref)} />
            <Stat label="Will" value={signed(s.will)} />
          </div>
          <div className="attrs-row">
            {ATTRS.map((a) => (
              <div key={a}><b>{s.attrs[a]}</b><span>{a.toUpperCase()}</span></div>
            ))}
          </div>
          <h3>Skills <small>rank + ability + feats</small></h3>
          <div className="ranks">
            {rules.skills.map((sk) => {
              const ability = mod(s.attrs[sk.ability])
              const bonus = s.skillBonus[sk.id]
              return (
                <div key={sk.id} title={`${s.ranks[sk.id]} ranks ${signed(ability)} ${sk.ability.toUpperCase()}${bonus ? ` +${bonus} feats` : ''}`}>
                  <span>{sk.name}</span><b>{s.ranks[sk.id] + ability + bonus}</b>
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'feats' && (
        <>
          <h3>Your picks</h3>
          <ul className="list">
            {picked.map((c) => row(c, 'feat'))}
            {picked.length === 0 && <li className="empty">None yet</li>}
          </ul>
          <details className="fold">
            <summary>Class features ({features.length})</summary>
            <ul className="list">{features.map((c) => row(c, 'feat'))}</ul>
          </details>
          {profs.length > 0 && (
            <p className="profs"><b>Proficiencies</b> {profs.flatMap((c) => c.chain.map((x) => profLabel(x.name))).join(' · ')}</p>
          )}
        </>
      )}

      {tab === 'powers' && (
        <>
          {(['light', 'universal', 'dark'] as const).map((side) => {
            const list = powers.filter((c) => c.top.side === side)
            if (!list.length) return null
            return (
              <div key={side}>
                <h3>{side === 'light' ? 'Light side' : side === 'dark' ? 'Dark side' : 'Universal'} ({list.length})</h3>
                <ul className="list">
                  {list.map((c) => row(c, 'power', <>
                    {GRANTED_POWERS.has(c.top.id) && <span className="auto">auto</span>}
                    <em>{powerCost(powerById.get(c.top.id)!, build.alignment, s.attrs.cha)} FP</em>
                  </>))}
                </ul>
              </div>
            )
          })}
          {powers.length === 0 && <p className="note">No Force powers yet.</p>}
          {powers.length > 0 && <p className="note">Tiered powers show their highest tier; pips count the tiers owned. Hover for the full chain.</p>}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, flag }: { label: string; value: number | string; flag?: string }) {
  return (
    <div className="stat">
      <b>{value}{flag && <sup title={flag}>?</sup>}</b>
      <span>{label}</span>
    </div>
  )
}
