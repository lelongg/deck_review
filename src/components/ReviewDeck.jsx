import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchPullRequest,
  fetchPullRequestFiles,
  fetchPullRequestDiff,
  createReviewComment,
  deleteReviewComment,
} from '../lib/github.js'
import { parsePatch, splitUnifiedDiff } from '../lib/parseDiff.js'
import { useViewed } from '../hooks/useViewed.js'
import { useComments } from '../hooks/useComments.js'
import ProgressGauge from './ProgressGauge.jsx'
import Card from './Card.jsx'
import FileList from './FileList.jsx'
import FinishSheet from './FinishSheet.jsx'
import { getJSON, setJSON } from '../lib/storage.js'
import { WRAP_KEY, VIEW_KEY } from '../lib/constants.js'

// Cycle order + button labels for the diff-side control.
const VIEW_ORDER = { unified: 'before', before: 'after', after: 'unified' }
const VIEW_LABEL = { unified: 'both', before: 'old', after: 'new' }

const SWIPE_THRESHOLD = 60 // px before a horizontal swipe commits

export default function ReviewDeck({ token, prRef, onExit }) {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null)
  const [files, setFiles] = useState([])
  const [active, setActive] = useState(0)

  const [fileListOpen, setFileListOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)

  // Soft-wrap long diff lines (default) vs. no-wrap + horizontal scroll.
  // Persisted as a global preference, not per-PR.
  const [wrap, setWrap] = useState(() => getJSON(WRAP_KEY, true))
  const toggleWrap = useCallback(() => {
    setWrap((w) => {
      const next = !w
      setJSON(WRAP_KEY, next)
      return next
    })
  }, [])

  // Diff side: show both, only the old (before), or only the new (after).
  const [view, setView] = useState(() => getJSON(VIEW_KEY, 'unified'))
  const cycleView = useCallback(() => {
    setView((v) => {
      const next = VIEW_ORDER[v] || 'unified'
      setJSON(VIEW_KEY, next)
      return next
    })
  }, [])

  const viewedApi = useViewed(token, prRef)
  const commentsApi = useComments(prRef)

  // Post a comment to GitHub immediately, then record it locally with the id
  // GitHub assigned. Rejects on failure so the composer can show the error and
  // keep the draft.
  const { addComment: storeComment, removeComment: dropComment } = commentsApi
  const headSha = meta?.headSha
  const postComment = useCallback(
    async (draft) => {
      const created = await createReviewComment(token, prRef, {
        commitId: headSha,
        path: draft.path,
        line: draft.line,
        side: draft.side,
        startLine: draft.startLine,
        startSide: draft.startSide,
        body: draft.body,
      })
      storeComment({
        id: created.id,
        path: draft.path,
        side: draft.side,
        line: draft.line,
        startSide: draft.startSide,
        startLine: draft.startLine,
        body: draft.body,
        htmlUrl: created.html_url,
      })
    },
    [token, prRef, headSha, storeComment],
  )

  // Delete the comment from GitHub, then drop it locally (404 = already gone).
  const unpostComment = useCallback(
    async (id) => {
      await deleteReviewComment(token, prRef, id)
      dropComment(id)
    },
    [token, prRef, dropComment],
  )

  // --- load PR meta + files ---------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError('')
    ;(async () => {
      try {
        const [m, rawFiles, diffText] = await Promise.all([
          fetchPullRequest(token, prRef),
          fetchPullRequestFiles(token, prRef),
          fetchPullRequestDiff(token, prRef),
        ])
        if (cancelled) return
        // The files endpoint omits `patch` for large files / large PRs; fill
        // those from the full unified diff so they still render inline.
        const diffMap = splitUnifiedDiff(diffText)
        const parsed = rawFiles.map((f) => {
          const patch = f.patch || diffMap.get(f.filename) || null
          return { ...f, patch, rows: parsePatch(patch) }
        })
        setMeta(m)
        setFiles(parsed)
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setError(err.message || 'Failed to load pull request.')
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, prRef])

  const total = files.length

  const goTo = useCallback(
    (index) => {
      if (total === 0) return
      const clamped = Math.max(0, Math.min(total - 1, index))
      setActive(clamped)
    },
    [total],
  )
  // Navigation skips files already marked viewed — the deck is a queue of what
  // still needs review. Returns -1 when there's nothing left in that direction.
  const findUnviewed = useCallback(
    (from, dir) => {
      for (let i = from + dir; i >= 0 && i < total; i += dir) {
        if (!viewedApi.isViewed(files[i].filename)) return i
      }
      return -1
    },
    [files, total, viewedApi],
  )
  const next = useCallback(() => {
    const t = findUnviewed(active, 1)
    if (t !== -1) goTo(t)
  }, [active, findUnviewed, goTo])
  const prev = useCallback(() => {
    const t = findUnviewed(active, -1)
    if (t !== -1) goTo(t)
  }, [active, findUnviewed, goTo])

  // Start on the first not-yet-viewed file (once, when the deck is ready).
  const positioned = useRef(false)
  useEffect(() => {
    if (status !== 'ready' || positioned.current || total === 0) return
    positioned.current = true
    const first = files.findIndex((f) => !viewedApi.isViewed(f.filename))
    if (first > 0) setActive(first)
  }, [status, files, total, viewedApi])

  const viewedCount = useMemo(
    () => files.filter((f) => viewedApi.isViewed(f.filename)).length,
    [files, viewedApi],
  )

  // LIFO history of mark-viewed actions this session, so they can be undone.
  // Each entry is a batch of filenames (a single file, or a whole folder), so
  // one undo reverts one action. Re-marking a file moves it to the newest batch.
  const [viewHistory, setViewHistory] = useState([])
  const recordViewed = useCallback((names) => {
    const set = new Set(names)
    setViewHistory((h) => [
      ...h.map((b) => b.filter((f) => !set.has(f))).filter((b) => b.length),
      names,
    ])
  }, [])
  const forgetViewed = useCallback((names) => {
    const set = new Set(names)
    setViewHistory((h) =>
      h.map((b) => b.filter((f) => !set.has(f))).filter((b) => b.length),
    )
  }, [])

  const markViewedAndAdvance = useCallback(
    (filename) => {
      viewedApi.setFileViewed(filename, true)
      recordViewed([filename])
      // auto-advance to the next not-yet-viewed card, else just next.
      const fromIndex = files.findIndex((f) => f.filename === filename)
      let target = -1
      for (let i = fromIndex + 1; i < files.length; i++) {
        if (!viewedApi.isViewed(files[i].filename)) {
          target = i
          break
        }
      }
      if (target === -1) {
        for (let i = 0; i < fromIndex; i++) {
          if (!viewedApi.isViewed(files[i].filename)) {
            target = i
            break
          }
        }
      }
      goTo(target === -1 ? fromIndex + 1 : target)
    },
    [files, viewedApi, goTo, recordViewed],
  )

  // Manual toggle from the card footer; keeps the undo history in sync.
  const toggleViewed = useCallback(
    (filename) => {
      const willView = !viewedApi.isViewed(filename)
      viewedApi.setFileViewed(filename, willView)
      if (willView) recordViewed([filename])
      else forgetViewed([filename])
    },
    [viewedApi, recordViewed, forgetViewed],
  )

  // Mark (or unmark) every file in a folder at once, from the file tree.
  const setDirViewed = useCallback(
    (filenames, value) => {
      filenames.forEach((f) => viewedApi.setFileViewed(f, value))
      if (value) recordViewed(filenames)
      else forgetViewed(filenames)
    },
    [viewedApi, recordViewed, forgetViewed],
  )

  // Undo the most recent mark-viewed action: unmark the whole batch and jump
  // back to its first file.
  const undoViewed = useCallback(() => {
    if (viewHistory.length === 0) return
    const batch = viewHistory[viewHistory.length - 1]
    batch.forEach((f) => viewedApi.setFileViewed(f, false))
    setViewHistory((h) => h.slice(0, -1))
    const idx = files.findIndex((f) => f.filename === batch[0])
    if (idx !== -1) goTo(idx)
  }, [viewHistory, viewedApi, files, goTo])

  // Keyboard shortcuts (defined here so the handlers above are in scope).
  useEffect(() => {
    function onKey(e) {
      if (fileListOpen || finishOpen) return
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'w' || e.key === 'W') toggleWrap()
      else if (e.key === 'v' || e.key === 'V') cycleView()
      else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        undoViewed()
      } else if (e.key === 'u' || e.key === 'U') undoViewed()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    next,
    prev,
    fileListOpen,
    finishOpen,
    toggleWrap,
    cycleView,
    undoViewed,
  ])

  if (status === 'loading') {
    return (
      <div className="deck deck--center">
        <div className="loader">
          <span className="loader__spin" aria-hidden />
          <p>loading {prRef.owner}/{prRef.repo} #{prRef.number}…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="deck deck--center">
        <div className="errorbox">
          <p className="errorbox__title">couldn’t open this PR</p>
          <p className="errorbox__msg">{error}</p>
          <button className="btn" onClick={onExit}>
            back
          </button>
        </div>
      </div>
    )
  }

  const activeFile = files[active]

  return (
    <div className="deck">
      <TopBar
        meta={meta}
        prRef={prRef}
        onMenu={() => setFileListOpen(true)}
        onFinish={() => setFinishOpen(true)}
        commentCount={commentsApi.comments.length}
        syncing={viewedApi.syncing}
        wrap={wrap}
        onToggleWrap={toggleWrap}
        view={view}
        onCycleView={cycleView}
      />

      <ProgressGauge
        done={viewedCount}
        total={total}
        canUndo={viewHistory.length > 0}
        onUndo={undoViewed}
      />

      <CardStack
        files={files}
        active={active}
        onNext={next}
        onPrev={prev}
        viewedApi={viewedApi}
        onToggleViewed={toggleViewed}
        commentsByPath={commentsApi.byPath}
        addComment={postComment}
        removeComment={unpostComment}
        onMarkViewed={markViewedAndAdvance}
        wrap={wrap}
        view={view}
      />

      <PositionDots total={total} active={active} />

      {fileListOpen && (
        <FileList
          files={files}
          active={active}
          isViewed={viewedApi.isViewed}
          onSetDirViewed={setDirViewed}
          commentsByPath={commentsApi.byPath}
          onPick={(i) => {
            goTo(i)
            setFileListOpen(false)
          }}
          onClose={() => setFileListOpen(false)}
        />
      )}

      {finishOpen && (
        <FinishSheet
          token={token}
          prRef={prRef}
          meta={meta}
          comments={commentsApi.comments}
          onClose={() => setFinishOpen(false)}
          onExit={onExit}
        />
      )}

      {!activeFile && (
        <div className="deck__empty">no files changed in this PR</div>
      )}
    </div>
  )
}

function TopBar({
  meta,
  prRef,
  onMenu,
  onFinish,
  commentCount,
  syncing,
  wrap,
  onToggleWrap,
  view,
  onCycleView,
}) {
  return (
    <header className="topbar">
      <button className="topbar__menu" onClick={onMenu} aria-label="file list">
        ☰
      </button>
      <button
        className={`topbar__view ${view !== 'unified' ? 'is-on' : ''}`}
        onClick={onCycleView}
        title={`Diff side: ${VIEW_LABEL[view]} (v)`}
      >
        {VIEW_LABEL[view]}
      </button>
      <button
        className={`topbar__wrap ${wrap ? 'is-on' : ''}`}
        onClick={onToggleWrap}
        aria-pressed={wrap}
        title={`Line wrap: ${wrap ? 'on' : 'off'} (w)`}
      >
        {wrap ? '↵' : '→'}
      </button>
      <div className="topbar__title">
        <span className="topbar__slug">
          {prRef.owner}/{prRef.repo} <em>#{prRef.number}</em>
          {syncing && <span className="topbar__sync" title="syncing viewed state">⟳</span>}
        </span>
        <span className="topbar__pr">{meta?.title}</span>
      </div>
      <button className="topbar__finish" onClick={onFinish}>
        finish
        {commentCount > 0 && <span className="badge">{commentCount}</span>}
      </button>
    </header>
  )
}

// The signature card stack: the active card with subtle depth behind it.
function CardStack({
  files,
  active,
  onNext,
  onPrev,
  viewedApi,
  onToggleViewed,
  commentsByPath,
  addComment,
  removeComment,
  onMarkViewed,
  wrap,
  view,
}) {
  const [drag, setDrag] = useState(0) // live horizontal drag offset
  const start = useRef(null)

  const file = files[active]

  function onTouchStart(e) {
    const t = e.touches[0]
    // In no-wrap mode the code body scrolls horizontally; remember it so a
    // horizontal pan over the code scrolls the code instead of swiping the
    // card (unless the code is already scrolled to the edge).
    const sx = e.target?.closest?.('.card__body--scroll-x')
    const scrollEl = sx && sx.scrollWidth > sx.clientWidth + 1 ? sx : null
    start.current = { x: t.clientX, y: t.clientY, locked: null, scrollEl }
  }
  function onTouchMove(e) {
    if (!start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    // Decide once: vertical scroll, horizontal card-swipe, or horizontal
    // code-scroll. Only 'x' drives the card.
    if (start.current.locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      if (Math.abs(dx) <= Math.abs(dy)) {
        start.current.locked = 'y'
      } else {
        // Horizontal: if over scrollable code that can still scroll this
        // direction, let it scroll; only swipe the card at the scroll edge.
        const el = start.current.scrollEl
        const atLeft = !el || el.scrollLeft <= 0
        const atRight =
          !el || el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
        const canSwipe = !el || (dx > 0 && atLeft) || (dx < 0 && atRight)
        start.current.locked = canSwipe ? 'x' : 'scroll'
      }
    }
    if (start.current.locked === 'x') {
      setDrag(dx)
    }
  }
  function onTouchEnd() {
    if (start.current?.locked === 'x') {
      if (drag <= -SWIPE_THRESHOLD) onNext()
      else if (drag >= SWIPE_THRESHOLD) onPrev()
    }
    start.current = null
    setDrag(0)
  }

  if (!file) return <div className="stack" />

  return (
    <div
      className="stack"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* depth ghosts */}
      <div className="stack__ghost stack__ghost--2" aria-hidden />
      <div className="stack__ghost stack__ghost--1" aria-hidden />

      <Card
        key={file.filename}
        file={file}
        index={active}
        total={files.length}
        dragX={drag}
        viewed={viewedApi.isViewed(file.filename)}
        comments={commentsByPath.get(file.filename) || []}
        onAddComment={addComment}
        onRemoveComment={removeComment}
        onToggleViewed={() => onToggleViewed(file.filename)}
        onMarkViewed={() => onMarkViewed(file.filename)}
        wrap={wrap}
        view={view}
      />
    </div>
  )
}

function PositionDots({ total, active }) {
  return (
    <div className="dots" aria-hidden>
      <span className="dots__label">
        {total === 0 ? 0 : active + 1} / {total}
      </span>
    </div>
  )
}
