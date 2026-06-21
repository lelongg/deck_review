import { useMemo, useRef, useState } from 'react'
import { commentKey } from '../lib/parseDiff.js'
import { languageForPath, useGrammar, highlightLine } from '../lib/highlight.js'

// Renders the parsed diff rows for a file, with inline comment composing.
//
// Two ways to anchor a comment:
//   - tap a row's code  -> single-line comment on that line
//   - press the line-number gutter and drag vertically -> multi-line range
//     (the gutter has touch-action:none so the drag selects instead of
//     scrolling; the code column still scrolls normally)
export default function DiffBody({
  rows,
  path,
  comments,
  onAddComment,
  onRemoveComment,
  wrap = true,
}) {
  // Syntax highlighting: load this file's grammar (lazily, from CDN) and
  // pre-highlight every code row once it's ready. Keyed by row id so it only
  // recomputes when the rows or the grammar change — not on every composer or
  // selection update.
  const grammar = useGrammar(languageForPath(path))
  const highlighted = useMemo(() => {
    if (!grammar) return null
    const map = new Map()
    for (const row of rows) {
      if (row.type === 'add' || row.type === 'del' || row.type === 'context') {
        const html = highlightLine(grammar, row.content)
        if (html != null) map.set(row.id, html)
      }
    }
    return map
  }, [grammar, rows])

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

  return (
    <div
      className={`diff ${wrap ? '' : 'diff--nowrap'} ${
        highlighted ? 'diff--hl' : ''
      }`}
    >
      {rows.map((row, idx) => {
        if (row.type === 'hunk') {
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
                <span className="diff__ln diff__ln--old">
                  {row.oldLine ?? ''}
                </span>
                <span className="diff__ln diff__ln--new">
                  {row.newLine ?? ''}
                </span>
              </span>
              <span
                className="diff__sign"
                onClick={commentable ? () => openSingle(idx) : undefined}
              >
                {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
              </span>
              <span
                className="diff__code"
                onClick={commentable ? () => openSingle(idx) : undefined}
                {...(highlighted?.has(row.id)
                  ? { dangerouslySetInnerHTML: { __html: highlighted.get(row.id) } }
                  : { children: row.content || ' ' })}
              />
            </div>

            {rowComments?.map((c) => (
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
      <span className="note__body">{comment.body}</span>
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
