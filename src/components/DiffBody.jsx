import { useMemo, useState } from 'react'
import { commentKey } from '../lib/parseDiff.js'

// Renders the parsed diff rows for a file, with inline comment composing.
// Tapping a commentable row (add/del/context — anything with an anchor) opens
// a composer; queued notes show inline beneath their line with a remove action.
export default function DiffBody({
  rows,
  path,
  comments,
  onAddComment,
  onRemoveComment,
}) {
  const [openRowId, setOpenRowId] = useState(null)

  // Index existing comments by their anchor (side+line) so we can render them
  // under the right row.
  const commentsByAnchor = useMemo(() => {
    const map = new Map()
    for (const c of comments) {
      const k = commentKey(path, c.side, c.line)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(c)
    }
    return map
  }, [comments, path])

  return (
    <div className="diff">
      {rows.map((row) => {
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
        const isOpen = openRowId === row.id

        return (
          <div key={row.id} className="diff__row-wrap">
            <div
              className={`diff__row diff__row--${row.type} ${
                commentable ? 'diff__row--commentable' : ''
              }`}
              onClick={
                commentable
                  ? () => setOpenRowId(isOpen ? null : row.id)
                  : undefined
              }
            >
              <span className="diff__ln diff__ln--old">
                {row.oldLine ?? ''}
              </span>
              <span className="diff__ln diff__ln--new">
                {row.newLine ?? ''}
              </span>
              <span className="diff__sign">
                {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
              </span>
              <span className="diff__code">{row.content || ' '}</span>
            </div>

            {rowComments?.map((c) => (
              <div key={c.id} className="note">
                <span className="note__side">
                  {c.side === 'LEFT' ? 'L' : 'R'}
                  {c.line}
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

            {isOpen && (
              <Composer
                onCancel={() => setOpenRowId(null)}
                onSubmit={(body) => {
                  onAddComment({
                    path,
                    side: row.side,
                    line: row.anchorLine,
                    body,
                  })
                  setOpenRowId(null)
                }}
                anchorLabel={`${row.side === 'LEFT' ? 'L' : 'R'}${row.anchorLine}`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Composer({ onSubmit, onCancel, anchorLabel }) {
  const [text, setText] = useState('')
  return (
    <div className="composer">
      <div className="composer__head">
        <span className="composer__anchor">{anchorLabel}</span>
        comment on this line
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
