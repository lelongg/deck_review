import { useEffect, useMemo, useState } from 'react'
import { getJSON, setJSON } from '../lib/storage.js'

// Slide-over file tree: jump to any card, see viewed + note state at a glance.
// Files are grouped into a collapsible folder tree (single-child folder chains
// are compressed, GitHub-style, into one row).
export default function FileList({
  files,
  prRef,
  onExit,
  active,
  isViewed,
  onSetDirViewed,
  commentsByPath,
  onPick,
  onClose,
}) {
  const tree = useMemo(() => buildTree(files), [files])
  // Collapsed folders persist per PR (across reopen and refresh).
  const collapseKey = `deck:collapsed:${prRef.owner}/${prRef.repo}#${prRef.number}`
  const [collapsed, setCollapsed] = useState(
    () => new Set(getJSON(collapseKey, [])),
  )
  useEffect(() => {
    setJSON(collapseKey, [...collapsed])
  }, [collapseKey, collapsed])
  const toggle = (path) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const shared = {
    active,
    isViewed,
    onSetDirViewed,
    commentsByPath,
    onPick,
    collapsed,
    toggle,
  }

  return (
    <div className="sheet" onClick={onClose}>
      <aside className="filelist" onClick={(e) => e.stopPropagation()}>
        <header className="filelist__head">
          <span>files · {files.length}</span>
          <button className="iconbtn" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>
        <div className="filelist__items">
          <TreeLevel node={tree} basePath="" depth={0} {...shared} />
        </div>
        <button className="filelist__leave" onClick={onExit}>
          ← leave this PR
        </button>
      </aside>
    </div>
  )
}

// Build a nested tree from the flat file list, keeping each file's original
// index (so onPick / active still address the deck by position).
function buildTree(files) {
  const root = { dirs: new Map(), files: [] }
  files.forEach((file, index) => {
    const parts = file.filename.split('/')
    let node = root
    for (let d = 0; d < parts.length - 1; d++) {
      const seg = parts[d]
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] })
      node = node.dirs.get(seg)
    }
    node.files.push({ file, index, name: parts[parts.length - 1] })
  })
  return root
}

function TreeLevel({ node, basePath, depth, ...rest }) {
  const dirs = [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      {dirs.map(([name, child]) => (
        <DirNode
          key={`${basePath}/${name}`}
          name={name}
          node={child}
          basePath={basePath}
          depth={depth}
          {...rest}
        />
      ))}
      {files.map((leaf) => (
        <FileRow key={leaf.file.filename} leaf={leaf} depth={depth} {...rest} />
      ))}
    </>
  )
}

// Gather every filename under a tree node (across all nested folders).
function collectFilenames(node) {
  const out = node.files.map((leaf) => leaf.file.filename)
  for (const [, child] of node.dirs) out.push(...collectFilenames(child))
  return out
}

function DirNode({ name, node, basePath, depth, ...rest }) {
  // Compress single-child folder chains (src/components/foo → one row).
  let label = name
  let path = `${basePath}/${name}`
  let cur = node
  while (cur.files.length === 0 && cur.dirs.size === 1) {
    const [childName, childNode] = [...cur.dirs.entries()][0]
    label += `/${childName}`
    path += `/${childName}`
    cur = childNode
  }
  const open = !rest.collapsed.has(path)

  const filenames = useMemo(() => collectFilenames(cur), [cur])
  const viewedN = filenames.filter((f) => rest.isViewed(f)).length
  const allViewed = filenames.length > 0 && viewedN === filenames.length
  const someViewed = viewedN > 0

  return (
    <>
      <div className="filelist__dir" style={{ paddingLeft: 8 + depth * 14 }}>
        <button
          className="filelist__dirtoggle"
          onClick={() => rest.toggle(path)}
        >
          <span className="filelist__chev">{open ? '▾' : '▸'}</span>
          <span className="filelist__dirname">{label}/</span>
        </button>
        <button
          className={`filelist__dircheck ${allViewed ? 'is-on' : ''}`}
          onClick={() => rest.onSetDirViewed(filenames, !allViewed)}
          title={allViewed ? 'unmark folder' : 'mark folder viewed'}
          aria-label={allViewed ? 'unmark folder' : 'mark folder viewed'}
        >
          {allViewed ? '✓' : someViewed ? '◐' : '○'}
        </button>
      </div>
      {open && (
        <TreeLevel node={cur} basePath={path} depth={depth + 1} {...rest} />
      )}
    </>
  )
}

function FileRow({ leaf, depth, active, isViewed, commentsByPath, onPick }) {
  const { file, index, name } = leaf
  const notes = commentsByPath.get(file.filename)?.length || 0
  const viewed = isViewed(file.filename)
  return (
    <button
      className={`filelist__item ${index === active ? 'filelist__item--active' : ''} ${
        viewed ? 'filelist__item--viewed' : ''
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onPick(index)}
    >
      <span className="filelist__check">{viewed ? '✓' : '○'}</span>
      <span className="filelist__name">{name}</span>
      <span className="filelist__stat">
        <span className="filelist__add">+{file.additions}</span>
        <span className="filelist__del">−{file.deletions}</span>
        {notes > 0 && <span className="filelist__notes">●{notes}</span>}
      </span>
    </button>
  )
}
