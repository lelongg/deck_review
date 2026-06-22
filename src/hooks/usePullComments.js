import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchReviewThreads,
  createCommentReply,
  resolveReviewThread,
} from '../lib/github.js'
import { commentKey } from '../lib/parseDiff.js'

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

  // Signature of the last applied thread set, so polling only re-renders when
  // something actually changed (comments, replies, resolved state).
  const sigRef = useRef('')
  const refresh = useCallback(async () => {
    try {
      const built = buildThreads(await fetchReviewThreads(token, ref))
      const sig = built
        .map(
          (t) =>
            `${t.threadId}:${t.isResolved}:${t.comments.map((c) => c.id).join(',')}`,
        )
        .join('|')
      if (sig === sigRef.current) return
      sigRef.current = sig
      setThreads(built)
    } catch {
      /* leave existing threads in place on failure */
    }
  }, [token, ref])

  // Initial load + keep threads fresh: poll on a light interval and on focus,
  // so replies (and notes becoming threads) show up without reopening the PR.
  useEffect(() => {
    refresh()
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    const id = setInterval(refresh, 45 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(id)
    }
  }, [refresh])

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

  return { byAnchor, ids, reply, resolveThread, refresh }
}
