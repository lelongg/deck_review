import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchReviewThreads,
  createCommentReply,
  resolveReviewThread,
} from '../lib/github.js'
import { commentKey } from '../lib/parseDiff.js'
import { getJSON, setJSON } from '../lib/storage.js'

// Normalize raw review threads (from GraphQL) into the shape the UI uses:
// each thread keeps its GraphQL node id (to resolve) and its root comment's
// REST id (to reply / track seen), and is anchored by the root's location.
function buildThreads(rawThreads) {
  const threads = []
  for (const rt of rawThreads) {
    const comments = [...rt.comments].sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id,
    )
    const root = comments[0]
    if (!root) continue
    threads.push({
      rootId: root.id,
      threadId: rt.threadId,
      isResolved: rt.isResolved,
      anchorKey:
        root.line != null ? commentKey(root.path, root.side, root.line) : null,
      comments,
    })
  }
  return threads
}

// Existing review-comment threads for one PR: display (unresolved) inline,
// reply, resolve, and badge unseen replies.
export function usePullComments(token, ref) {
  const [threads, setThreads] = useState([])

  // Threads are collapsed by default; persist the expanded set per PR.
  const openKey = `deck:threadsopen:${ref.owner}/${ref.repo}#${ref.number}`
  const [expanded, setExpanded] = useState(() => new Set(getJSON(openKey, [])))
  useEffect(() => {
    setJSON(openKey, [...expanded])
  }, [openKey, expanded])

  // Per-thread "seen up to" comment id, persisted, to badge new replies.
  const seenKey = `deck:threadseen:${ref.owner}/${ref.repo}#${ref.number}`
  const [seen, setSeen] = useState(() => getJSON(seenKey, {}))
  useEffect(() => {
    setJSON(seenKey, seen)
  }, [seenKey, seen])

  const refresh = useCallback(async () => {
    try {
      const raw = await fetchReviewThreads(token, ref)
      setThreads(buildThreads(raw))
    } catch {
      /* leave existing threads in place on failure */
    }
  }, [token, ref])

  useEffect(() => {
    refresh()
  }, [refresh])

  const maxIdByRoot = useMemo(() => {
    const m = new Map()
    for (const t of threads) {
      let max = 0
      for (const c of t.comments) if (c.id > max) max = c.id
      m.set(t.rootId, max)
    }
    return m
  }, [threads])

  const markSeen = useCallback(
    (rootId) => {
      const maxId = maxIdByRoot.get(rootId)
      if (maxId == null) return
      setSeen((prev) =>
        (prev[rootId] || 0) >= maxId ? prev : { ...prev, [rootId]: maxId },
      )
    },
    [maxIdByRoot],
  )

  const toggleThread = useCallback(
    (rootId) => {
      const opening = !expanded.has(rootId)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(rootId)) next.delete(rootId)
        else next.add(rootId)
        return next
      })
      if (opening) markSeen(rootId)
    },
    [expanded, markSeen],
  )

  const reply = useCallback(
    async (rootId, body) => {
      const created = await createCommentReply(token, ref, rootId, body)
      setThreads((ts) =>
        ts.map((t) =>
          t.rootId === rootId
            ? {
                ...t,
                comments: [
                  ...t.comments,
                  {
                    id: created.id,
                    body: created.body,
                    author: created.user?.login || '',
                    createdAt: created.created_at,
                  },
                ],
              }
            : t,
        ),
      )
      setSeen((prev) => ({
        ...prev,
        [rootId]: Math.max(prev[rootId] || 0, created.id),
      }))
    },
    [token, ref],
  )

  // Resolve a thread (optimistically hide it; roll back on failure).
  const resolveThread = useCallback(
    async (threadId) => {
      setThreads((ts) =>
        ts.map((t) => (t.threadId === threadId ? { ...t, isResolved: true } : t)),
      )
      try {
        await resolveReviewThread(token, threadId, true)
      } catch {
        setThreads((ts) =>
          ts.map((t) =>
            t.threadId === threadId ? { ...t, isResolved: false } : t,
          ),
        )
      }
    },
    [token],
  )

  // Only unresolved threads are shown, grouped by anchor for per-row lookup.
  const byAnchor = useMemo(() => {
    const map = new Map()
    for (const t of threads) {
      if (t.isResolved || !t.anchorKey) continue
      if (!map.has(t.anchorKey)) map.set(t.anchorKey, [])
      map.get(t.anchorKey).push(t)
    }
    return map
  }, [threads])

  // Every server comment id (incl. resolved), so locally-posted notes already
  // on the server aren't shown twice.
  const ids = useMemo(() => {
    const s = new Set()
    for (const t of threads) for (const c of t.comments) s.add(c.id)
    return s
  }, [threads])

  const unseen = useMemo(() => {
    const m = new Map()
    for (const t of threads) {
      const base = seen[t.rootId] || 0
      m.set(t.rootId, t.comments.filter((c) => c.id > base).length)
    }
    return m
  }, [threads, seen])

  return {
    byAnchor,
    ids,
    reply,
    resolveThread,
    refresh,
    expanded,
    toggleThread,
    unseen,
  }
}
