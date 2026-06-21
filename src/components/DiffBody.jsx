import { useEffect, useMemo, useRef, useState } from 'react'
import { commentKey } from '../lib/parseDiff.js'
import { languageForPath, useGrammar, useHighlightedRows } from '../lib/highlight.js'
import { renderMarkdown } from '../lib/markdown.js'
import {
  isThreadOpen,
  setThreadOpen,
  getThreadSeen,
  setThreadSeen,
} from '../lib/threadState.js'

// Renders the parsed diff rows for a file, with inline comment composing.
//
// Two ways to anchor a comment:
//   - tap a row's code  -> single-line comment on that line
//   - press the line-number gutter and drag vertically -> multi-line range
//     (the gutter has touch-action:none so the drag selects instead of
//     scrolling; the code column still scrolls normally)
// Drop the side the current view hides: 'before' keeps old (context + del),
// 'after' keeps new (context + add); hunk/meta always stay.
function filterRows(rows, view) {
  if (view === 'before') return rows.filter((r) => r.type !== 'add')
  if (view === 'after') return rows.filter((r) => r.type !== 'del')
  return rows
}

export default function DiffBody({
  rows: allRows,
  full = false,
  path,
  prRef,
  comments,
  threadsByAnchor,
  serverCommentIds,
  onReply,
  onResolveThread,
  onAddComment,
  onRemoveComment,
  wrap = true,
  view = 'unified',
}) {
  // Rows actually shown (and interacted with) for the chosen diff side.
  const rows = useMemo(() => filterRows(allRows, view), [allRows, view])
  // Syntax highlighting: load this file's grammar (lazily, from CDN) and
  // highlight every code row once it's ready (async — see useHighlightedRows).
  const grammar = useGrammar(languageForPath(path))
  // Highlight the full row set so the map (keyed by row id) stays stable when
  // the view filters rows in/out.
  const highlighted = useHighlightedRows(grammar, allRows)

  // composer: null | { kind:'single'|'range', anchorIdx, top, bottom }
  const [composer, setComposer] = useState(null)
  // live drag selection over row indices: null | { lo, hi }
  const [sel, setSel] = useState(null)
  const drag = useRef(null) // { startIdx, moved }

  // Index existing comments by their anchor (side+line) so we render them
  // under the right (end) row.
  const commentsByAnchor = useMemo(() => {
    const map = new Map()
    for (const c of comments) {
      const k = commentKey(path, c.side, c.line)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(c)
    }
    return map
  }, [comments, path])

  // Resolve the topmost/bottommost commentable rows within an index range.
  function resolveRange(lo, hi) {
    let top = null
    let bottom = null
    for (let i = lo; i <= hi; i++) {
      if (rows[i].anchorLine != null) {
        if (!top) top = rows[i]
        bottom = rows[i]
      }
    }
    return { top, bottom }
  }

  function idxFromPoint(clientX, clientY) {
    const el = document
      .elementFromPoint(clientX, clientY)
      ?.closest('[data-rowidx]')
    return el ? Number(el.dataset.rowidx) : null
  }

  function onGutterDown(e, idx) {
    if (rows[idx].anchorLine == null) return
    drag.current = { startIdx: idx, moved: false }
    setSel({ lo: idx, hi: idx })
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onGutterMove(e) {
    if (!drag.current) return
    const idx = idxFromPoint(e.clientX, e.clientY)
    if (idx == null) return
    if (idx !== drag.current.startIdx) drag.current.moved = true
    const lo = Math.min(drag.current.startIdx, idx)
    const hi = Math.max(drag.current.startIdx, idx)
    setSel({ lo, hi })
  }
  function onGutterUp() {
    const d = drag.current
    drag.current = null
    if (!d || !sel) {
      setSel(null)
      return
    }
    const { top, bottom } = resolveRange(sel.lo, sel.hi)
    setSel(null)
    if (!top) return
    if (!d.moved || top === bottom) {
      // tap (or single-row selection) -> single-line composer
      setComposer({ kind: 'single', anchorIdx: indexOf(top), top, bottom: top })
    } else {
      setComposer({
        kind: 'range',
        anchorIdx: indexOf(bottom),
        top,
        bottom,
      })
    }
  }

  function indexOf(row) {
    return rows.indexOf(row)
  }

  function openSingle(idx) {
    const row = rows[idx]
    if (row.anchorLine == null) return
    setComposer((cur) =>
      cur && cur.kind === 'single' && cur.anchorIdx === idx
        ? null
        : { kind: 'single', anchorIdx: idx, top: row, bottom: row },
    )
  }

  // Posts the comment to GitHub (onAddComment); resolves on success so the
  // Composer can close, rejects so it can show the error and keep the draft.
  async function submitComposer(body) {
    const { top, bottom } = composer
    await onAddComment({
      path,
      side: bottom.side,
      line: bottom.anchorLine,
      startSide: top === bottom ? undefined : top.side,
      startLine: top === bottom ? undefined : top.anchorLine,
      body,
    })
    setComposer(null)
  }

  // A one-sided view of a pure add/delete file can have no lines to show.
  const hasCode = rows.some(
    (r) => r.type === 'add' || r.type === 'del' || r.type === 'context',
  )
  if (!hasCode) {
    return (
      <div className="diff diff--empty">
        nothing to show in the {view === 'before' ? 'before' : 'after'} view
      </div>
    )
  }

  return (
    <div
      className={`diff ${wrap ? '' : 'diff--nowrap'} ${
        highlighted ? 'diff--hl' : ''
      }`}
    >
      {rows.map((row, idx) => {
        if (row.type === 'hunk') {
          // In full-file view there's a single all-encompassing hunk; its
          // header is just noise, so hide it.
          if (full) return null
          return (
            <div key={row.id} className="diff__hunk">
              {row.content}
            </div>
          )
        }
        if (row.type === 'meta') {
          return (
            <div key={row.id} className="diff__meta">
              ⮐ {row.content}
            </div>
          )
        }

        const anchorK =
          row.anchorLine != null
            ? commentKey(path, row.side, row.anchorLine)
            : null
        const rowComments = anchorK ? commentsByAnchor.get(anchorK) : null
        const rowThreads = anchorK ? threadsByAnchor?.get(anchorK) : null
        const commentable = row.anchorLine != null
        const selected = sel && idx >= sel.lo && idx <= sel.hi && commentable
        const composerHere = composer && composer.anchorIdx === idx

        return (
          <div key={row.id} className="diff__row-wrap">
            <div
              data-rowidx={idx}
              className={`diff__row diff__row--${row.type} ${
                commentable ? 'diff__row--commentable' : ''
              } ${selected ? 'diff__row--selected' : ''}`}
            >
              <span
                className="diff__gutter"
                onPointerDown={
                  commentable ? (e) => onGutterDown(e, idx) : undefined
                }
                onPointerMove={commentable ? onGutterMove : undefined}
                onPointerUp={commentable ? onGutterUp : undefined}
                onPointerCancel={commentable ? onGutterUp : undefined}
              >
                {row.newLine ?? row.oldLine ?? ''}
              </span>
              <span
                className="diff__code"
                onClick={commentable ? () => openSingle(idx) : undefined}
                {...(highlighted?.has(row.id)
                  ? { dangerouslySetInnerHTML: { __html: highlighted.get(row.id) } }
                  : { children: row.content || ' ' })}
              />
            </div>

            {rowThreads?.map((t) => (
              <Thread
                key={t.rootId}
                thread={t}
                prRef={prRef}
                onReply={onReply}
                onResolve={() => onResolveThread(t.threadId)}
              />
            ))}

            {rowComments
              ?.filter((c) => !serverCommentIds?.has(c.id))
              .map((c) => (
                <Note key={c.id} comment={c} onRemove={onRemoveComment} />
              ))}

            {composerHere && (
              <Composer
                label={composerLabel(composer)}
                onCancel={() => setComposer(null)}
                onSubmit={submitComposer}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function shortSide(side, line) {
  return `${side === 'LEFT' ? 'L' : 'R'}${line}`
}
function anchorLabel(c) {
  if (c.startLine != null && c.startLine !== c.line) {
    return `${shortSide(c.startSide || c.side, c.startLine)}–${shortSide(
      c.side,
      c.line,
    )}`
  }
  return shortSide(c.side, c.line)
}
function composerLabel(composer) {
  const { top, bottom } = composer
  if (top === bottom) return shortSide(top.side, top.anchorLine)
  return `${shortSide(top.side, top.anchorLine)}–${shortSide(
    bottom.side,
    bottom.anchorLine,
  )}`
}

// An existing review-comment thread (root + replies) shown inline, with a
// reply box that posts into the thread. Owns its expand/seen state locally
// (persisted) so toggling it doesn't re-render the whole diff.
function Thread({ thread, prRef, onReply, onResolve }) {
  const { rootId } = thread
  const [expanded, setExpanded] = useState(() => isThreadOpen(prRef, rootId))
  const [seen, setSeen] = useState(() => getThreadSeen(prRef, rootId))
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')

  const maxId = useMemo(
    () => thread.comments.reduce((m, c) => Math.max(m, c.id), 0),
    [thread.comments],
  )
  const unseen = thread.comments.filter((c) => c.id > seen).length

  // Reading an expanded thread (incl. after a new reply) marks it seen.
  useEffect(() => {
    if (expanded && maxId > seen) {
      setThreadSeen(prRef, rootId, maxId)
      setSeen(maxId)
    }
  }, [expanded, maxId, seen, prRef, rootId])

  function toggle() {
    setExpanded((v) => {
      const next = !v
      setThreadOpen(prRef, rootId, next)
      return next
    })
  }

  async function send() {
    const body = text.trim()
    if (!body || posting) return
    setPosting(true)
    setError('')
    try {
      await onReply(thread.rootId, body)
      setText('')
      setOpen(false)
    } catch (err) {
      setError(err.message || 'Failed to reply.')
    } finally {
      setPosting(false)
    }
  }

  const count = thread.comments.length
  const rootAuthor = thread.comments[0]?.author

  return (
    <div className="thread">
      <div className="thread__head">
        <button
          className="thread__toggle"
          onClick={toggle}
          aria-expanded={expanded}
        >
          <span className="thread__chev">{expanded ? '▾' : '▸'}</span>
          <span className="thread__author">{rootAuthor}</span>
          <span className="thread__meta">
            {count} comment{count > 1 ? 's' : ''}
          </span>
          {!expanded && unseen > 0 && (
            <span className="thread__badge">{unseen} new</span>
          )}
        </button>
        <button
          className="thread__resolve"
          onClick={onResolve}
          title="Resolve conversation"
        >
          ✓ resolve
        </button>
      </div>

      {expanded && (
        <>
          {thread.comments.map((c) => (
            <div key={c.id} className="thread__comment">
              <span className="thread__author">{c.author}</span>
              <div
                className="thread__body markdown"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
              />
            </div>
          ))}
          {open ? (
        <div className="thread__reply">
          <textarea
            className="composer__input"
            autoFocus
            rows={2}
            disabled={posting}
            placeholder="reply…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
            }}
          />
          {error && <p className="composer__error">{error}</p>}
          <div className="composer__actions">
            <button
              className="btn btn--ghost"
              disabled={posting}
              onClick={() => setOpen(false)}
            >
              cancel
            </button>
            <button
              className="btn btn--primary"
              disabled={!text.trim() || posting}
              onClick={send}
            >
              {posting ? 'replying…' : 'reply'}
            </button>
          </div>
        </div>
          ) : (
            <button className="thread__replybtn" onClick={() => setOpen(true)}>
              reply
            </button>
          )}
        </>
      )}
    </div>
  )
}

// An inline note for a posted comment, with a remove control that deletes it
// from GitHub. Disabled while the delete is in flight; if it fails the note
// stays so you can retry.
function Note({ comment, onRemove }) {
  const [removing, setRemoving] = useState(false)
  async function remove() {
    if (removing) return
    setRemoving(true)
    try {
      await onRemove(comment.id)
      // success: parent drops this note and it unmounts
    } catch {
      setRemoving(false)
    }
  }
  return (
    <div className={`note ${removing ? 'note--busy' : ''}`}>
      <span className="note__side">{anchorLabel(comment)}</span>
      <div
        className="note__body markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(comment.body) }}
      />
      <button
        className="note__remove"
        onClick={remove}
        disabled={removing}
        aria-label="remove note"
      >
        ×
      </button>
    </div>
  )
}

function Composer({ onSubmit, onCancel, label }) {
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    const body = text.trim()
    if (!body || posting) return
    setPosting(true)
    setError('')
    try {
      await onSubmit(body)
      // success: parent closes the composer and it unmounts
    } catch (err) {
      setError(err.message || 'Failed to post comment.')
      setPosting(false)
    }
  }

  return (
    <div className="composer">
      <div className="composer__head">
        <span className="composer__anchor">{label}</span>
        comment on {label.includes('–') ? 'these lines' : 'this line'}
      </div>
      <textarea
        className="composer__input"
        autoFocus
        rows={3}
        disabled={posting}
        placeholder="leave a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
        }}
      />
      {error && <p className="composer__error">{error}</p>}
      <div className="composer__actions">
        <button
          className="btn btn--ghost"
          onClick={onCancel}
          disabled={posting}
        >
          cancel
        </button>
        <button
          className="btn btn--primary"
          disabled={!text.trim() || posting}
          onClick={send}
        >
          {posting ? 'posting…' : 'add note'}
        </button>
      </div>
    </div>
  )
}
