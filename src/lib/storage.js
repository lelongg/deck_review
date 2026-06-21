// Safe persistence layer.
//
// localStorage throws in a number of real situations: sandboxed iframes
// (`SecurityError`), Safari private mode (historically), quota exhaustion,
// and disabled site data. We never want any of those to crash the app, so
// every access is wrapped and falls back to an in-memory Map that lives for
// the page session. The public surface mirrors the bits of the Storage API
// we actually use.

const memory = new Map()

let backing = null
try {
  // Touch it to confirm it both exists and is writable (private-mode quirks).
  const probe = '__deck_probe__'
  window.localStorage.setItem(probe, '1')
  window.localStorage.removeItem(probe)
  backing = window.localStorage
} catch {
  backing = null
}

export const storageAvailable = backing !== null

export function getItem(key) {
  if (backing) {
    try {
      return backing.getItem(key)
    } catch {
      /* fall through to memory */
    }
  }
  return memory.has(key) ? memory.get(key) : null
}

export function setItem(key, value) {
  if (backing) {
    try {
      backing.setItem(key, value)
      return
    } catch {
      /* fall through to memory */
    }
  }
  memory.set(key, value)
}

export function removeItem(key) {
  if (backing) {
    try {
      backing.removeItem(key)
      return
    } catch {
      /* fall through to memory */
    }
  }
  memory.delete(key)
}

// JSON convenience wrappers — return `fallback` on any parse/read failure.
export function getJSON(key, fallback) {
  const raw = getItem(key)
  if (raw == null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function setJSON(key, value) {
  try {
    setItem(key, JSON.stringify(value))
  } catch {
    /* value not serializable — ignore */
  }
}
