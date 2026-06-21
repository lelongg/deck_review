// Slide-over file list: jump to any card, see viewed + note state at a glance.
export default function FileList({
  files,
  active,
  isViewed,
  commentsByPath,
  onPick,
  onClose,
}) {
  return (
    <div className="sheet" onClick={onClose}>
      <aside
        className="filelist"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="filelist__head">
          <span>files · {files.length}</span>
          <button className="iconbtn" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>
        <ul className="filelist__items">
          {files.map((f, i) => {
            const notes = commentsByPath.get(f.filename)?.length || 0
            return (
              <li key={f.filename}>
                <button
                  className={`filelist__item ${
                    i === active ? 'filelist__item--active' : ''
                  } ${isViewed(f.filename) ? 'filelist__item--viewed' : ''}`}
                  onClick={() => onPick(i)}
                >
                  <span className="filelist__check">
                    {isViewed(f.filename) ? '✓' : '○'}
                  </span>
                  <span className="filelist__name">{f.filename}</span>
                  <span className="filelist__stat">
                    <span className="filelist__add">+{f.additions}</span>
                    <span className="filelist__del">−{f.deletions}</span>
                    {notes > 0 && <span className="filelist__notes">●{notes}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    </div>
  )
}
