import DiffBody from './DiffBody.jsx'

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
  viewed,
  comments,
  threadsByAnchor,
  serverCommentIds,
  onReply,
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

  return (
    <article className={`card ${viewed ? 'card--viewed' : ''}`} style={style}>
      <header className="card__head">
        <div className="card__pathwrap">
          <span className="card__path">
            {dir && <span className="card__dir">{dir}/</span>}
            <span className="card__base">{base}</span>
          </span>
          {file.previousFilename && (
            <span className="card__renamed">← {file.previousFilename}</span>
          )}
        </div>

        <div className="card__metarow">
          <span className={`chip chip--${file.status}`}>
            {STATUS_LABEL[file.status] || file.status}
          </span>
          <span className="card__adds">+{file.additions}</span>
          <span className="card__dels">−{file.deletions}</span>
          {comments.length > 0 && (
            <span className="card__notes">
              {comments.length} note{comments.length > 1 ? 's' : ''}
            </span>
          )}
          {viewed && <span className="card__viewedchip">viewed</span>}
          <span className="card__count">
            {index + 1}/{total}
          </span>
        </div>
      </header>

      <div className={`card__body ${wrap ? '' : 'card__body--scroll-x'}`}>
        {file.patch ? (
          <DiffBody
            rows={file.rows}
            path={file.filename}
            comments={comments}
            threadsByAnchor={threadsByAnchor}
            serverCommentIds={serverCommentIds}
            onReply={onReply}
            onAddComment={onAddComment}
            onRemoveComment={onRemoveComment}
            wrap={wrap}
            view={view}
          />
        ) : (
          <div className="card__nopatch">
            {file.status === 'removed'
              ? 'file removed'
              : 'no inline diff available (binary or too large)'}
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

function splitPath(filename) {
  const i = filename.lastIndexOf('/')
  if (i === -1) return { dir: '', base: filename }
  return { dir: filename.slice(0, i), base: filename.slice(i + 1) }
}
