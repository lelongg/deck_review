import { useMemo, useRef, useState } from 'react'
import { commentKey } from '../lib/parseDiff.js'

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

  function submitComposer(body) {
    const { top, bottom } = composer
    onAddComment({
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
    <div className={`diff ${wrap ? '' : 'diff--nowrap'}`}>
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
              >
                {row.content || ' '}
              </span>
            </div>

            {rowComments?.map((c) => (
              <div key={c.id} className="note">
                <span className="note__side">
                  {anchorLabel(c)}
                </span>
                <span className="note__body">{c.body}</span>
                <button
                  className="note__remove"
                  onClick={() => onRemoveComment(c.id)}
                  aria-label="remove note"
                >
                  ×
                </button>
              </div>
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

function Composer({ onSubmit, onCancel, label }) {
  const [text, setText] = useState('')
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
        placeholder="leave a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim()) {
            onSubmit(text.trim())
          }
        }}
      />
      <div className="composer__actions">
        <button className="btn btn--ghost" onClick={onCancel}>
          cancel
        </button>
        <button
          className="btn btn--primary"
          disabled={!text.trim()}
          onClick={() => text.trim() && onSubmit(text.trim())}
        >
          add note
        </button>
      </div>
    </div>
  )
}
