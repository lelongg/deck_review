import { useCallback, useEffect, useMemo, useState } from 'react'
import { getJSON, setJSON } from '../lib/storage.js'
import { commentKey } from '../lib/parseDiff.js'

const keyFor = (ref) => `deck:comments:${ref.owner}/${ref.repo}#${ref.number}`

// Queue of pending review comments for one PR, persisted as a draft so notes
// survive a reload before the review is submitted. Each comment:
//   { id, path, side, line, body }
export function useComments(ref) {
  const storageKey = keyFor(ref)
  const [comments, setComments] = useState(() => getJSON(storageKey, []))

  useEffect(() => {
    setJSON(storageKey, comments)
  }, [storageKey, comments])

  const addComment = useCallback(
    ({ path, side, line, body, startSide, startLine }) => {
      setComments((prev) => [
        ...prev,
        {
          id: `${commentKey(path, side, line)}::${Date.now()}`,
          path,
          side,
          line,
          // Multi-line range anchor (optional). Present only when the user
          // selected more than one line.
          startSide: startLine != null ? startSide : undefined,
          startLine: startLine != null ? startLine : undefined,
          body,
        },
      ])
    },
    [],
  )

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
