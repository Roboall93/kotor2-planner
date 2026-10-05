// Anonymous usage counts via GoatCounter (script tag in index.html): page visits
// plus a few named events. No cookies, nothing per-user, and no build data: the
// build lives in the URL after '#', which GoatCounter doesn't send.

declare global {
  interface Window {
    goatcounter?: { count?: (opts: { path: string; title?: string; event?: boolean }) => void }
  }
}

export type UsageEvent = 'share-link-copied' | 'share-link-opened' | 'new-build'

/** Counts an event. The counter script loads async, so wait for it briefly
 *  (up to ~10 s) rather than dropping events fired during startup. */
export function track(event: UsageEvent, tries = 20) {
  const count = window.goatcounter?.count
  if (count) count({ path: event, title: event, event: true })
  else if (tries > 0) setTimeout(() => track(event, tries - 1), 500)
}
