import { useEffect, useMemo, useState } from 'react'
import {
  ATTRS, ATTR_NAMES, BASE_CLASSES, MAX_LEVEL, POINT_BUY, PRESTIGE_MIN_LEVEL,
  classById, decodeBuild, emptyLevel, encodeBuild, featBlocked, featById, isClassSkill, mod, newBuild,
  pointCost, powerBlocked, powerById, powerCost, prestigeOptions, rankCap, rules, simulate,
  type Attr, type Build, type LevelChoice, type LevelState,
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

export default function App() {
  const [build, setBuild] = useState<Build>(loadInitial)
  const [open, setOpen] = useState<number | null>(0)
  const [viewLevel, setViewLevel] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const states = useMemo(() => simulate(build), [build])
  const code = useMemo(() => encodeBuild(build), [build])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  }, [code])

  const update = (fn: (b: Build) => void) =>
    setBuild((prev) => {
      const next = structuredClone(prev)
      fn(next)
      return next
    })

  const spent = ATTRS.reduce((t, a) => t + pointCost(build.attrs[a]), 0)
  const shown = states[Math.min(viewLevel ?? states.length - 1, states.length - 1)]
  const totalIssues = states.reduce((t, s) => t + s.issues.length, 0)

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
    })

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
          <button onClick={() => { if (confirm('Start a new build? The current one will be replaced.')) { setBuild(newBuild()); setOpen(0) } }}>New</button>
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
                  onClick={() => update((b) => { b.base = c.id; b.prestige = null })}
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
                <button aria-label={`Lower ${ATTR_NAMES[a]}`} disabled={build.attrs[a] <= 8} onClick={() => update((b) => { b.attrs[a]-- })}>−</button>
                <span className="attr-val">{build.attrs[a]}</span>
                <button
                  aria-label={`Raise ${ATTR_NAMES[a]}`}
                  disabled={build.attrs[a] >= 18 || spent - pointCost(build.attrs[a]) + pointCost(build.attrs[a] + 1) > POINT_BUY}
                  onClick={() => update((b) => { b.attrs[a]++ })}
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
              onChange={(e) => update((b) => { b.prestige = e.target.value || null })}
            >
              <option value="">None</option>
              {prestigeOptions(build.base).map((c) => (
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
                  })}
                />
              </label>
            )}
            <p className="note">
              {build.levels.length < PRESTIGE_MIN_LEVEL
                ? `Plan to level ${PRESTIGE_MIN_LEVEL}+ to unlock.`
                : `Available from level ${PRESTIGE_MIN_LEVEL}; the game also requires a matching alignment.`}
            </p>
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
            <span className={`pill ${totalIssues ? 'warn' : 'ok'}`}>{totalIssues ? `${totalIssues} to resolve` : 'All valid'}</span>
          </h2>
          {states.map((s, i) => (
            <LevelRow
              key={i}
              state={s}
              prev={states[i - 1]}
              choice={build.levels[i]}
              prevChoice={build.levels[i - 1]}
              build={build}
              open={open === i}
              onToggle={() => { setOpen(open === i ? null : i); setViewLevel(i) }}
              onChange={(fn) => update((b) => fn(b.levels[i]))}
            />
          ))}
        </section>

        <section className="col summary">
          <Summary state={shown} build={build} onLevel={(l) => setViewLevel(l - 1)} max={states.length} />
        </section>
      </main>

      <footer>
        Fan-made tool. Not affiliated with Lucasfilm, Obsidian or Aspyr. Values marked ? are not yet confirmed in game.
      </footer>
    </div>
  )
}

function LevelRow({ state: s, prev, choice, prevChoice, build, open, onToggle, onChange }: {
  state: LevelState
  prev?: LevelState
  choice: LevelChoice
  prevChoice?: LevelChoice
  build: Build
  open: boolean
  onToggle: () => void
  onChange: (fn: (l: LevelChoice) => void) => void
}) {
  const ownedBefore = new Set([...(prev?.ownedFeats ?? [206]), ...s.granted])
  const powersBefore = prev?.ownedPowers ?? new Set<number>()
  const featOptions = rules.feats.filter(
    (f) => !ownedBefore.has(f.id) && !choice.feats.includes(f.id) && !featBlocked(f.id, s.cls, s.level, ownedBefore),
  )
  const powerOptions = rules.powers.filter(
    (p) => !powersBefore.has(p.id) && !choice.powers.includes(p.id) && !powerBlocked(p.id, s.cls, s.level, powersBefore),
  )
  const prestigeStart = build.prestige && s.level === build.prestigeAt

  return (
    <div className={`level ${open ? 'open' : ''} ${s.issues.length ? 'has-issues' : ''}`}>
      <button className="level-head" onClick={onToggle} aria-expanded={open}>
        <span className="lv">{s.level}</span>
        <span className="lv-class">
          {s.cls.name} {s.classLevel}
          {prestigeStart && <span className="pill gold">Prestige</span>}
        </span>
        <span className="lv-picks">
          {choice.feats.map((f) => <span key={f} className="chip feat">{featById.get(f)?.name}</span>)}
          {choice.powers.map((p) => <span key={p} className="chip power">{powerById.get(p)?.name}</span>)}
          {choice.attr && <span className="chip attr">+1 {choice.attr.toUpperCase()}</span>}
        </span>
        {s.issues.length > 0 && <span className="dot" title={s.issues.join('\n')}>{s.issues.length}</span>}
      </button>

      {open && (
        <div className="level-body">
          {s.granted.length > 0 && (
            <p className="granted">Granted automatically: {s.granted.map((f) => featById.get(f)?.name).join(', ')}</p>
          )}

          {s.level % 4 === 0 && (
            <div className="field">
              <label>Attribute increase</label>
              <div className="seg small">
                {ATTRS.map((a) => (
                  <button key={a} className={choice.attr === a ? 'on' : ''} onClick={() => onChange((l) => { l.attr = a as Attr })}>
                    {a.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Picker
            label={`Feats (${choice.feats.length}/${s.featPicks})`}
            chosen={choice.feats}
            nameOf={(id) => featById.get(id)?.name ?? `#${id}`}
            descOf={(id) => featById.get(id)?.description ?? ''}
            options={featOptions.map((f) => ({ id: f.id, name: f.name }))}
            full={choice.feats.length >= s.featPicks}
            onAdd={(id) => onChange((l) => { l.feats.push(id) })}
            onRemove={(id) => onChange((l) => { l.feats = l.feats.filter((x) => x !== id) })}
          />

          <Picker
            label={`Force powers (${choice.powers.length}/${s.powerPicks})`}
            chosen={choice.powers}
            nameOf={(id) => powerById.get(id)?.name ?? `#${id}`}
            descOf={(id) => {
              const p = powerById.get(id)
              return p ? `${p.side} · ${powerCost(p, build.alignment)} FP\n\n${p.description}` : ''
            }}
            options={powerOptions.map((p) => ({ id: p.id, name: `${p.name} (${p.side[0].toUpperCase()}, ${powerCost(p, build.alignment)} FP)` }))}
            full={choice.powers.length >= s.powerPicks}
            onAdd={(id) => onChange((l) => { l.powers.push(id) })}
            onRemove={(id) => onChange((l) => { l.powers = l.powers.filter((x) => x !== id) })}
          />
          {s.level === 1 && <p className="note">The Exile starts cut off from the Force, so level 1 has no power picks.</p>}

          <div className="field">
            <label>Skills ({s.skillPointsSpent}/{s.skillPoints} points)</label>
            <div className="skills">
              {rules.skills.map((sk) => {
                const cls = isClassSkill(s.cls, sk.id)
                const cost = cls ? 1 : 2
                const gained = s.ranks[sk.id] - (prev?.ranks[sk.id] ?? 0)
                const canAdd = s.skillPointsSpent + cost <= s.skillPoints && s.ranks[sk.id] < rankCap(s.cls, sk.id, s.level)
                return (
                  <div className="skill" key={sk.id} title={sk.description}>
                    <span className={cls ? '' : 'cross'}>{sk.name}{!cls && <small> cross-class</small>}</span>
                    <button aria-label={`Lower ${sk.name}`} disabled={!choice.skills[sk.id]} onClick={() => onChange((l) => { l.skills[sk.id] -= cost })}>−</button>
                    <span className="rank">{s.ranks[sk.id]}</span>
                    <button aria-label={`Raise ${sk.name}`} disabled={!canAdd} onClick={() => onChange((l) => { l.skills[sk.id] += cost })}>+</button>
                    <span className="mod">{gained > 0 ? `+${gained}` : ''}</span>
                  </div>
                )
              })}
            </div>
            {prevChoice && (
              <button
                className="link"
                onClick={() => onChange((l) => {
                  let budget = s.skillPoints
                  l.skills = prevChoice.skills.map((pts) => {
                    const take = Math.min(pts, budget)
                    budget -= take
                    return take
                  })
                })}
              >Repeat previous level's skills</button>
            )}
          </div>

          {s.issues.length > 0 && (
            <ul className="issues">{s.issues.map((t, k) => <li key={k}>{t}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}

function Picker({ label, chosen, nameOf, descOf, options, full, onAdd, onRemove }: {
  label: string
  chosen: number[]
  nameOf: (id: number) => string
  descOf: (id: number) => string
  options: { id: number; name: string }[]
  full: boolean
  onAdd: (id: number) => void
  onRemove: (id: number) => void
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {chosen.length > 0 && (
        <div className="chosen">
          {chosen.map((id) => (
            <div key={id} className="pick">
              <div className="pick-head">
                <b>{nameOf(id)}</b>
                <button aria-label={`Remove ${nameOf(id)}`} onClick={() => onRemove(id)}>×</button>
              </div>
              <p>{descOf(id)}</p>
            </div>
          ))}
        </div>
      )}
      {!full && (
        <select value="" onChange={(e) => e.target.value && onAdd(+e.target.value)}>
          <option value="">{options.length ? 'Add…' : 'Nothing eligible'}</option>
          {[...options].sort((a, b) => a.name.localeCompare(b.name)).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      )}
    </div>
  )
}

function Summary({ state: s, build, onLevel, max }: { state: LevelState; build: Build; onLevel: (l: number) => void; max: number }) {
  const feats = [...s.ownedFeats].flatMap((id) => featById.get(id) ?? [])
  const powers = [...s.ownedPowers].flatMap((id) => powerById.get(id) ?? [])
  return (
    <div className="card sticky">
      <h2>
        Character at level
        <input
          type="number" min={1} max={max} value={s.level} aria-label="Summary level"
          onChange={(e) => onLevel(Math.max(1, Math.min(max, +e.target.value || 1)))}
        />
      </h2>
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
      <h3>Skills <small>rank + ability</small></h3>
      <div className="ranks">
        {rules.skills.map((sk) => (
          <div key={sk.id}><span>{sk.name}</span><b>{s.ranks[sk.id] + mod(s.attrs[sk.ability])}</b></div>
        ))}
      </div>
      <h3>Force powers ({powers.length})</h3>
      <ul className="list">
        {powers.map((p) => (
          <li key={p.id} title={p.description}>
            <span className={`side ${p.side}`} aria-label={`${p.side} side`} />{p.name}<em>{powerCost(p, build.alignment)} FP</em>
          </li>
        ))}
        {powers.length === 0 && <li className="empty">None yet</li>}
      </ul>
      <h3>Feats ({feats.length})</h3>
      <ul className="list">
        {feats.map((f) => <li key={f.id} title={f.description}>{f.name}</li>)}
      </ul>
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
