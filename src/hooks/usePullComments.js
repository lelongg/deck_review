import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchPullRequestComments,
  createCommentReply,
} from '../lib/github.js'
import { commentKey } from '../lib/parseDiff.js'
import { getJSON, setJSON } from '../lib/storage.js'

// Group a flat list of review comments into threads. A thread is a root
// comment plus its replies (in_reply_to_id chains resolved to the root), and
// is anchored on the diff by the root's (path, side, line).
function buildThreads(comments) {
  const byId = new Map(comments.map((c) => [c.id, c]))
  const rootOf = (c) => {
    let cur = c
    const seen = new Set()
    while (
      cur.inReplyToId != null &&
      byId.has(cur.inReplyToId) &&
      !seen.has(cur.id)
    ) {
      seen.add(cur.id)
      cur = byId.get(cur.inReplyToId)
    }
    return cur
  }

  const groups = new Map()
  for (const c of comments) {
    const root = rootOf(c)
    if (!groups.has(root.id)) groups.set(root.id, { root, comments: [] })
    groups.get(root.id).comments.push(c)
  }

  const threads = []
  for (const { root, comments: cs } of groups.values()) {
    cs.sort((a, b) =>
      a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id,
    )
    threads.push({
      rootId: root.id,
      anchorKey:
        root.line != null ? commentKey(root.path, root.side, root.line) : null,
      comments: cs,
    })
  }
  return threads
}

// Existing review-comment threads for one PR, with the ability to reply.
export function usePullComments(token, ref) {
  const [threads, setThreads] = useState([])

  // Threads are collapsed by default; we persist the set of expanded ones per
  // PR so the open/closed state survives reopening cards and reloads.
  const openKey = `deck:threadsopen:${ref.owner}/${ref.repo}#${ref.number}`
  const [expanded, setExpanded] = useState(() => new Set(getJSON(openKey, [])))
  useEffect(() => {
    setJSON(openKey, [...expanded])
  }, [openKey, expanded])

  // Per-thread "seen up to" comment id, persisted, so new replies can be
  // badged. Highest comment id is the newest (GitHub ids are monotonic).
  const seenKey = `deck:threadseen:${ref.owner}/${ref.repo}#${ref.number}`
  const [seen, setSeen] = useState(() => getJSON(seenKey, {}))
  useEffect(() => {
    setJSON(seenKey, seen)
  }, [seenKey, seen])

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
      if (opening) markSeen(rootId) // reading it clears its new-reply badge
    },
    [expanded, markSeen],
  )

  // rootId -> number of comments newer than what's been seen.
  const unseen = useMemo(() => {
    const m = new Map()
    for (const t of threads) {
      const base = seen[t.rootId] || 0
      m.set(t.rootId, t.comments.filter((c) => c.id > base).length)
    }
    return m
  }, [threads, seen])

  const refresh = useCallback(async () => {
    try {
      const comments = await fetchPullRequestComments(token, ref)
      setThreads(buildThreads(comments))
    } catch {
      /* leave existing threads in place on failure */
    }
  }, [token, ref])

  useEffect(() => {
    refresh()
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
                    inReplyToId: created.in_reply_to_id ?? rootId,
                    body: created.body,
                    author: created.user?.login || '',
                    createdAt: created.created_at,
                  },
                ],
              }
            : t,
        ),
      )
      // Your own reply is already "seen".
      setSeen((prev) => ({
        ...prev,
        [rootId]: Math.max(prev[rootId] || 0, created.id),
      }))
    },
    [token, ref],
  )

  // Threads grouped by their anchor (path+side+line) for per-row lookup.
  const byAnchor = useMemo(() => {
    const map = new Map()
    for (const t of threads) {
      if (!t.anchorKey) continue
      if (!map.has(t.anchorKey)) map.set(t.anchorKey, [])
      map.get(t.anchorKey).push(t)
    }
    return map
  }, [threads])

  // Every server comment id, so locally-posted notes already on the server
  // aren't shown twice.
  const ids = useMemo(() => {
    const s = new Set()
    for (const t of threads) for (const c of t.comments) s.add(c.id)
    return s
  }, [threads])

  return { byAnchor, ids, reply, refresh, expanded, toggleThread, unseen }
}
