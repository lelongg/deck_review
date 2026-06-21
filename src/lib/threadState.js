import { getJSON, setJSON } from './storage.js'

// Per-PR persistence for review-thread UI state (expanded + seen), read/written
// directly so a thread can own its state locally — toggling one thread then
// only re-renders that thread, not the whole diff.

const openKey = (ref) => `deck:threadsopen:${ref.owner}/${ref.repo}#${ref.number}`
const seenKey = (ref) => `deck:threadseen:${ref.owner}/${ref.repo}#${ref.number}`

export function isThreadOpen(ref, rootId) {
  return getJSON(openKey(ref), []).includes(rootId)
}

export function setThreadOpen(ref, rootId, open) {
  const set = new Set(getJSON(openKey(ref), []))
  if (open) set.add(rootId)
  else set.delete(rootId)
  setJSON(openKey(ref), [...set])
}

export function getThreadSeen(ref, rootId) {
  return getJSON(seenKey(ref), {})[rootId] || 0
}

export function setThreadSeen(ref, rootId, maxId) {
  const map = getJSON(seenKey(ref), {})
  if ((map[rootId] || 0) >= maxId) return
  map[rootId] = maxId
  setJSON(seenKey(ref), map)
}
