import { useMemo, useRef } from 'react'
import DiffBody from './DiffBody.jsx'
import { useFileDiff } from '../lib/fileDiff.js'

// Collapse runs of changed rows into segments for the scroll-area minimap,
// positioned by their fraction through the file.
function changeSegments(rows) {
  if (!rows || rows.length === 0) return []
  const segs = []
  let cur = null
  rows.forEach((r, i) => {
    const type = r.type === 'add' || r.type === 'del' ? r.type : null
    if (type && cur && cur.type === type && cur.end === i - 1) {
      cur.end = i
    } else if (type) {
      cur = { type, start: i, end: i }
      segs.push(cur)
    } else {
      cur = null
    }
  })
  const n = rows.length
  return segs.map((s) => ({
    type: s.type,
    top: (s.start / n) * 100,
    height: Math.max(0.5, ((s.end - s.start + 1) / n) * 100),
  }))
}

const STATUS_LABEL = {
  added: 'new',
  removed: 'del',
  modified: 'mod',
  renamed: 'ren',
  copied: 'cp',
  changed: 'chg',
  unchanged: '—',
}

export default function Card({
  file,
  index,
  total,
  dragX,
  token,
  prRef,
  baseSha,
  headSha,
  viewed,
  comments,
  threadsByAnchor,
  serverCommentIds,
  onReply,
  onResolveThread,
  expandedThreads,
  onToggleThread,
  unseenThreads,
  onAddComment,
  onRemoveComment,
  onToggleViewed,
  onMarkViewed,
  wrap,
  view,
}) {
  // Pull the active card a little toward the finger; fade slightly as it goes.
  const style = dragX
    ? {
        transform: `translateX(${dragX}px) rotate(${dragX * 0.02}deg)`,
        opacity: 1 - Math.min(Math.abs(dragX) / 600, 0.25),
      }
    : undefined

  const { dir, base } = splitPath(file.filename)

  // Always show the whole file for context: fetch its blobs and build a
  // full-file diff. Until that's ready, show the partial patch (if GitHub gave
  // one) so there's no wait; fall back to a message otherwise.
  const lazy = useFileDiff(token, prRef, file, baseSha, headSha)
  const full = lazy.status === 'ready'
  const rows = full ? lazy.rows : file.patch ? file.rows : null
  const showDiff = full || !!file.patch
  const segments = useMemo(() => changeSegments(rows), [rows])

  // Click / drag the minimap to scroll the diff to that fraction of the file.
  const bodyRef = useRef(null)
  function scrollToEvent(e) {
    const body = bodyRef.current
    if (!body) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    body.scrollTop = frac * (body.scrollHeight - body.clientHeight)
  }

  return (
    <article className={`card ${viewed ? 'card--viewed' : ''}`} style={style}>
      <header className="card__head">
        <span
          className="card__path"
          title={
            file.previousFilename
              ? `${file.filename} (renamed from ${file.previousFilename})`
              : file.filename
          }
        >
          {dir && <span className="card__dir">{dir}/</span>}
          <span className="card__base">{base}</span>
        </span>

        <span className="card__metarow">
          <span className={`chip chip--${file.status}`}>
            {STATUS_LABEL[file.status] || file.status}
          </span>
          <span className="card__adds">+{file.additions}</span>
          <span className="card__dels">−{file.deletions}</span>
          {comments.length > 0 && (
            <span className="card__notes">●{comments.length}</span>
          )}
          <span className="card__count">
            {index + 1}/{total}
          </span>
        </span>
      </header>

      <div className="card__bodywrap">
        <div
          ref={bodyRef}
          className={`card__body ${wrap ? '' : 'card__body--scroll-x'}`}
        >
          {showDiff ? (
            <DiffBody
              rows={rows}
              full={full}
              path={file.filename}
              comments={comments}
              threadsByAnchor={threadsByAnchor}
              serverCommentIds={serverCommentIds}
              onReply={onReply}
              onResolveThread={onResolveThread}
              expandedThreads={expandedThreads}
              onToggleThread={onToggleThread}
              unseenThreads={unseenThreads}
              onAddComment={onAddComment}
              onRemoveComment={onRemoveComment}
              wrap={wrap}
              view={view}
            />
          ) : (
            <div className="card__nopatch">
              {nopatchMessage(file, lazy.status)}
            </div>
          )}
        </div>
        {showDiff && segments.length > 0 && (
          <div
            className="minimap"
            aria-hidden
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              scrollToEvent(e)
            }}
            onPointerMove={(e) => {
              if (e.buttons) scrollToEvent(e)
            }}
          >
            {segments.map((s, i) => (
              <span
                key={i}
                className={`minimap__mark minimap__mark--${s.type}`}
                style={{ top: `${s.top}%`, height: `${s.height}%` }}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="card__foot">
        <button
          className={`btn btn--mark ${viewed ? 'btn--marked' : ''}`}
          onClick={viewed ? onToggleViewed : onMarkViewed}
        >
          {viewed ? 'viewed ✓ — unmark' : 'mark viewed'}
        </button>
      </footer>
    </article>
  )
}

function nopatchMessage(file, status) {
  if (status === 'loading') return 'loading diff…'
  if (status === 'binary') return 'binary file'
  if (status === 'toolarge') return 'file too large to display'
  if (status === 'error') return 'couldn’t load this diff'
  if (file.status === 'removed') return 'file removed'
  return 'no inline diff available'
}

function splitPath(filename) {
  const i = filename.lastIndexOf('/')
  if (i === -1) return { dir: '', base: filename }
  return { dir: filename.slice(0, i), base: filename.slice(i + 1) }
}
