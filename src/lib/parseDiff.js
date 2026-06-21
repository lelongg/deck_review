// Hand-written unified-diff parser (no dependency).
//
// GitHub gives us each file's `patch` as a standard unified diff. We walk it
// line by line, tracking the old and new file line numbers so every rendered
// row knows exactly which line a review comment would anchor to.
//
// Comment anchoring (verified against the GitHub review API):
//   - additions and context lines -> side "RIGHT", line = NEW line number
//   - deletions                   -> side "LEFT",  line = OLD line number
//
// The "\ No newline at end of file" marker is metadata: it advances nothing.

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/

let nextId = 0

// Parse a patch string into a flat list of rows. Rows of type "hunk" carry
// the section header; "meta" rows are the no-newline marker. Each add/del/
// context row carries { oldLine, newLine, side, anchorLine } for commenting.
export function parsePatch(patch) {
  const rows = []
  if (!patch) return rows

  let oldLine = 0
  let newLine = 0

  for (const raw of patch.split('\n')) {
    const hunk = raw.match(HUNK_RE)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      rows.push({
        id: nextId++,
        type: 'hunk',
        content: raw,
        section: hunk[3].trim(),
      })
      continue
    }

    const marker = raw[0]

    if (marker === '+') {
      rows.push({
        id: nextId++,
        type: 'add',
        content: raw.slice(1),
        oldLine: null,
        newLine,
        side: 'RIGHT',
        anchorLine: newLine,
      })
      newLine++
    } else if (marker === '-') {
      rows.push({
        id: nextId++,
        type: 'del',
        content: raw.slice(1),
        oldLine,
        newLine: null,
        side: 'LEFT',
        anchorLine: oldLine,
      })
      oldLine++
    } else if (marker === '\\') {
      // "\ No newline at end of file" — metadata only.
      rows.push({ id: nextId++, type: 'meta', content: raw.slice(1).trim() })
    } else {
      // Context line (leading space, or an empty trailing line from split).
      rows.push({
        id: nextId++,
        type: 'context',
        content: marker === ' ' ? raw.slice(1) : raw,
        oldLine,
        newLine,
        side: 'RIGHT',
        anchorLine: newLine,
      })
      oldLine++
      newLine++
    }
  }

  // A trailing newline in the patch yields one empty context row; drop it so
  // we don't render a phantom blank line at the end of every file.
  if (rows.length && rows[rows.length - 1].type === 'context') {
    const last = rows[rows.length - 1]
    if (last.content === '') rows.pop()
  }

  return rows
}

// A stable key for a queued comment, so we can de-dupe / locate them.
export function commentKey(path, side, line) {
  return `${path}::${side}::${line}`
}

// Split a whole-PR unified diff (the `application/vnd.github.diff` payload)
// into a Map of filename -> patch, where each patch starts at the first hunk
// header (`@@`) — matching the shape of the REST per-file `patch` field that
// parsePatch expects. Binary files (no textual hunk) are skipped.
export function splitUnifiedDiff(text) {
  const map = new Map()
  if (!text) return map

  // Each file section begins with a "diff --git a/… b/…" line.
  const sections = text.split(/^diff --git /m)
  for (const section of sections) {
    if (!section.trim()) continue

    // Resolve the file path: prefer the new path (`+++ b/…`); for deletions
    // (`+++ /dev/null`) fall back to the old path (`--- a/…`).
    let path = null
    const plus = section.match(/^\+\+\+ b\/(.+)$/m)
    if (plus) {
      path = plus[1]
    } else {
      const minus = section.match(/^--- a\/(.+)$/m)
      if (minus) path = minus[1]
    }
    if (!path) continue

    // Git quotes paths containing unusual characters; unwrap those.
    path = path.trim()
    if (path.startsWith('"') && path.endsWith('"')) {
      try {
        path = JSON.parse(path)
      } catch {
        /* leave as-is */
      }
    }

    const at = section.indexOf('\n@@')
    if (at === -1) continue // binary or no textual hunk
    map.set(path, section.slice(at + 1))
  }
  return map
}
