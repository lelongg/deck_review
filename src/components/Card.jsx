import DiffBody from './DiffBody.jsx'
import { useFileDiff } from '../lib/fileDiff.js'

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

  // When GitHub gave us no patch (large file / oversized PR diff), rebuild it
  // from the file's blobs on demand.
  const lazy = useFileDiff(token, prRef, file, baseSha, headSha)
  const rows = file.patch ? file.rows : lazy.rows
  const showDiff = !!file.patch || lazy.status === 'ready'

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

      <div className={`card__body ${wrap ? '' : 'card__body--scroll-x'}`}>
        {showDiff ? (
          <DiffBody
            rows={rows}
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
          <div className="card__nopatch">{nopatchMessage(file, lazy.status)}</div>
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
