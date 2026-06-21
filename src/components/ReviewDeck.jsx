import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchPullRequest,
  fetchPullRequestFiles,
} from '../lib/github.js'
import { parsePatch } from '../lib/parseDiff.js'
import { useViewed } from '../hooks/useViewed.js'
import { useComments } from '../hooks/useComments.js'
import ProgressGauge from './ProgressGauge.jsx'
import Card from './Card.jsx'
import FileList from './FileList.jsx'
import FinishSheet from './FinishSheet.jsx'

const SWIPE_THRESHOLD = 60 // px before a horizontal swipe commits

export default function ReviewDeck({ token, prRef, onExit }) {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null)
  const [files, setFiles] = useState([])
  const [active, setActive] = useState(0)

  const [fileListOpen, setFileListOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)

  const viewedApi = useViewed(token, prRef)
  const commentsApi = useComments(prRef)

  // --- load PR meta + files ---------------------------------------------------
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError('')
    ;(async () => {
      try {
        const [m, rawFiles] = await Promise.all([
          fetchPullRequest(token, prRef),
          fetchPullRequestFiles(token, prRef),
        ])
        if (cancelled) return
        const parsed = rawFiles.map((f) => ({ ...f, rows: parsePatch(f.patch) }))
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
  const next = useCallback(() => goTo(active + 1), [active, goTo])
  const prev = useCallback(() => goTo(active - 1), [active, goTo])

  // Arrow-key fallback for navigation.
  useEffect(() => {
    function onKey(e) {
      if (fileListOpen || finishOpen) return
      if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, fileListOpen, finishOpen])

  const viewedCount = useMemo(
    () => files.filter((f) => viewedApi.isViewed(f.filename)).length,
    [files, viewedApi],
  )

  const markViewedAndAdvance = useCallback(
    (filename) => {
      viewedApi.setFileViewed(filename, true)
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
    [files, viewedApi, goTo],
  )

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
      />

      <ProgressGauge done={viewedCount} total={total} />

      <CardStack
        files={files}
        active={active}
        onNext={next}
        onPrev={prev}
        viewedApi={viewedApi}
        commentsByPath={commentsApi.byPath}
        addComment={commentsApi.addComment}
        removeComment={commentsApi.removeComment}
        onMarkViewed={markViewedAndAdvance}
      />

      <PositionDots total={total} active={active} />

      {fileListOpen && (
        <FileList
          files={files}
          active={active}
          isViewed={viewedApi.isViewed}
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
          onClearComments={commentsApi.clearComments}
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

function TopBar({ meta, prRef, onMenu, onFinish, commentCount, syncing }) {
  return (
    <header className="topbar">
      <button className="topbar__menu" onClick={onMenu} aria-label="file list">
        ☰
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
  commentsByPath,
  addComment,
  removeComment,
  onMarkViewed,
}) {
  const [drag, setDrag] = useState(0) // live horizontal drag offset
  const start = useRef(null)

  const file = files[active]

  function onTouchStart(e) {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, locked: null }
  }
  function onTouchMove(e) {
    if (!start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    // Decide once whether this gesture is a horizontal swipe or a vertical
    // scroll; only horizontal-dominant gestures drive the card.
    if (start.current.locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      start.current.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
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
        onToggleViewed={() => viewedApi.toggleViewed(file.filename)}
        onMarkViewed={() => onMarkViewed(file.filename)}
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
