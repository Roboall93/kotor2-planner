// "My builds": every build is kept in this browser's localStorage. Nothing leaves
// the device. Each operation re-reads storage before writing, so two open tabs
// don't overwrite each other's builds.
import { classById, decodeBuild, encodeBuild, newBuild, type Build } from './engine'

export interface SavedBuild {
  id: string
  code: string // encodeBuild() output, the same string a share link carries
  updated: number // ms since epoch
}

export interface Library {
  activeId: string
  builds: SavedBuild[]
}

const KEY = 'kotor2-planner-builds'
const OLD_KEY = 'kotor2-planner-build' // single autosave from before the list existed

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`)

function read(): Library {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const lib = JSON.parse(raw) as Library
      if (Array.isArray(lib.builds)) return { activeId: lib.activeId, builds: lib.builds.filter((s) => decodeBuild(s.code)) }
    }
    const old = localStorage.getItem(OLD_KEY)
    if (old && decodeBuild(old)) {
      const id = newId()
      return { activeId: id, builds: [{ id, code: old, updated: Date.now() }] }
    }
  } catch { /* storage unavailable or corrupt: start fresh */ }
  return { activeId: '', builds: [] }
}

function write(lib: Library) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib))
    localStorage.removeItem(OLD_KEY)
  } catch { /* private mode / storage full: the build still lives in the URL */ }
}

/** Reads, applies a change, writes, and returns the new library. */
function change(fn: (lib: Library) => void): Library {
  const lib = read()
  fn(lib)
  if (!lib.builds.some((s) => s.id === lib.activeId)) {
    if (!lib.builds.length) lib.builds.push({ id: newId(), code: encodeBuild(newBuild()), updated: Date.now() })
    lib.activeId = lib.builds[0].id
  }
  write(lib)
  return lib
}

export const loadLibrary = (): Library => change(() => {})

/** Read without writing; for refreshing after another tab's change. */
export const readLibrary = (): Library => read()

/** Adds a build (e.g. from a share link) unless an identical one is already
 *  saved, makes it active, and returns its id. */
export function importBuild(code: string): { lib: Library; id: string; added: boolean } {
  const normal = encodeBuild(decodeBuild(code)!) // v1 links and v2 links of the same build match
  let id = ''
  let added = false
  const lib = change((l) => {
    // Compare re-encoded codes: a build saved in an older link format still matches.
    id = l.builds.find((s) => s.code === normal || encodeBuild(decodeBuild(s.code)!) === normal)?.id ?? ''
    if (!id) {
      id = newId()
      added = true
      l.builds.unshift({ id, code: normal, updated: Date.now() })
    }
    l.activeId = id
  })
  return { lib, id, added }
}

export const saveActive = (id: string, code: string) =>
  change((l) => {
    const s = l.builds.find((x) => x.id === id)
    if (s) {
      if (s.code !== code) { s.code = code; s.updated = Date.now() }
    } else {
      l.builds.unshift({ id, code, updated: Date.now() }) // deleted in another tab while open here
    }
    l.activeId = id
  })

export const setActive = (id: string) => change((l) => { l.activeId = id })

export function addBuild(b: Build): { lib: Library; id: string } {
  const id = newId()
  const lib = change((l) => {
    l.builds.unshift({ id, code: encodeBuild(b), updated: Date.now() })
    l.activeId = id
  })
  return { lib, id }
}

export const removeBuild = (id: string) => change((l) => { l.builds = l.builds.filter((s) => s.id !== id) })

/** Label for the list: the build's name, or its class path when unnamed. */
export function describe(s: SavedBuild) {
  const b = decodeBuild(s.code)!
  const cls = classById[b.base].name.replace('Jedi ', '')
  const path = b.prestige ? `${cls} → ${classById[b.prestige].name}` : cls
  return { name: b.name.trim() || `Untitled ${cls}`, meta: `${path} · level ${b.levels.length}` }
}

export function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(ms).toLocaleDateString()
}

