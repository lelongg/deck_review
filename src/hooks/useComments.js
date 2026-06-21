import { useCallback, useEffect, useMemo, useState } from 'react'
import { getJSON, setJSON } from '../lib/storage.js'

const keyFor = (ref) => `deck:comments:${ref.owner}/${ref.repo}#${ref.number}`

// Local record of the review comments posted for one PR, persisted so they
// stay visible on each card across reloads. Comments are posted to GitHub the
// moment they're created (see ReviewDeck), so each entry already carries the
// real GitHub comment `id` (used to delete it) plus { path, side, line, body }.
export function useComments(ref) {
  const storageKey = keyFor(ref)
  const [comments, setComments] = useState(() => getJSON(storageKey, []))

  useEffect(() => {
    setJSON(storageKey, comments)
  }, [storageKey, comments])

  // Append an already-posted comment (id assigned by GitHub).
  const addComment = useCallback((comment) => {
    setComments((prev) => [...prev, comment])
  }, [])

  const removeComment = useCallback((id) => {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const clearComments = useCallback(() => setComments([]), [])

  // Group by file path for quick per-card lookup.
  const byPath = useMemo(() => {
    const map = new Map()
    for (const c of comments) {
      if (!map.has(c.path)) map.set(c.path, [])
      map.get(c.path).push(c)
    }
    return map
  }, [comments])

  return { comments, byPath, addComment, removeComment, clearComments }
}
