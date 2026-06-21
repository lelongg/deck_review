import { useCallback, useEffect, useRef, useState } from 'react'
import { getJSON, setJSON } from '../lib/storage.js'
import {
  fetchViewedState,
  fetchPullRequestNodeId,
  setFileViewedState,
} from '../lib/github.js'

const keyFor = (ref) => `deck:viewed:${ref.owner}/${ref.repo}#${ref.number}`

// Per-file viewed state for one PR. Persisted to localStorage immediately, and
// (best-effort) synced to GitHub's own per-file "Viewed" checkboxes via
// GraphQL so the same state shows up in the web UI and on other devices.
export function useViewed(token, ref) {
  const storageKey = keyFor(ref)
  const [viewed, setViewed] = useState(() => getJSON(storageKey, {}))
  const [syncing, setSyncing] = useState(false)
  const nodeIdRef = useRef(null)

  // Persist on every change.
  useEffect(() => {
    setJSON(storageKey, viewed)
  }, [storageKey, viewed])

  // On mount (per PR), pull the server-side viewed state and merge it in.
  useEffect(() => {
    let cancelled = false
    nodeIdRef.current = null
    setSyncing(true)
    ;(async () => {
      try {
        const [serverViewed, nodeId] = await Promise.all([
          fetchViewedState(token, ref),
          fetchPullRequestNodeId(token, ref),
        ])
        if (cancelled) return
        nodeIdRef.current = nodeId
        // Server is the source of truth for cross-device state; union it with
        // any local-only marks the user made offline.
        setViewed((local) => ({ ...local, ...serverViewed }))
      } catch {
        /* GraphQL unavailable for this token — stay local-only. */
      } finally {
        if (!cancelled) setSyncing(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const isViewed = useCallback((filename) => !!viewed[filename], [viewed])

  const setFileViewed = useCallback(
    (filename, value) => {
      setViewed((prev) => {
        const next = { ...prev }
        if (value) next[filename] = true
        else delete next[filename]
        return next
      })
      // Fire-and-forget server sync.
      const nodeId = nodeIdRef.current
      if (nodeId) {
        setFileViewedState(token, nodeId, filename, value).catch(() => {})
      }
    },
    [token],
  )

  const toggleViewed = useCallback(
    (filename) => setFileViewed(filename, !viewed[filename]),
    [viewed, setFileViewed],
  )

  return { viewed, isViewed, setFileViewed, toggleViewed, syncing }
}
