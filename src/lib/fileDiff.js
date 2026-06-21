import { useEffect, useState } from 'react'
import { structuredPatch } from 'diff'
import { fetchFileText } from './github.js'
import { parsePatch } from './parseDiff.js'

// Skip client-side diffing past this size (chars) — too slow/heavy on a phone.
const MAX_BYTES = 1.5 * 1024 * 1024
const NUL = String.fromCharCode(0)

function isBinary(text) {
  return text != null && text.indexOf(NUL) !== -1
}

// Cache resolved diffs (per PR head + file) so swiping back is instant.
const cache = new Map()

// Build a whole-file unified-diff patch (full context) from before/after text,
// so the diff renders in the context of the entire file.
function fullPatch(path, baseText, headText) {
  const sp = structuredPatch(path, path, baseText ?? '', headText ?? '', '', '', {
    context: Number.MAX_SAFE_INTEGER,
  })
  const lines = []
  for (const h of sp.hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
    for (const l of h.lines) lines.push(l)
  }
  return lines.join('\n')
}

// Fetch a file's before/after blobs and produce full-file diff rows. Used for
// every viewed card so changes are shown in the context of the whole file (and
// it also covers files GitHub gave no patch for). Returns { status, rows } —
// status is idle | loading | ready | binary | toolarge | error.
export function useFileDiff(token, prRef, file, baseSha, headSha) {
  const [state, setState] = useState({ status: 'idle' })

  useEffect(() => {
    if (!headSha) {
      setState({ status: 'idle' })
      return
    }
    const cacheKey = `${prRef.owner}/${prRef.repo}@${headSha}::${file.filename}`
    const cached = cache.get(cacheKey)
    if (cached) {
      setState(cached)
      return
    }
    let alive = true
    setState({ status: 'loading' })
    ;(async () => {
      try {
        const [headText, baseText] = await Promise.all([
          fetchFileText(token, prRef, file.filename, headSha),
          baseSha
            ? fetchFileText(
                token,
                prRef,
                file.previousFilename || file.filename,
                baseSha,
              )
            : Promise.resolve(null),
        ])
        let result
        if (isBinary(headText) || isBinary(baseText)) {
          result = { status: 'binary' }
        } else if (
          (headText && headText.length > MAX_BYTES) ||
          (baseText && baseText.length > MAX_BYTES)
        ) {
          result = { status: 'toolarge' }
        } else {
          const patch = fullPatch(file.filename, baseText, headText)
          result = { status: 'ready', rows: parsePatch(patch) }
        }
        cache.set(cacheKey, result)
        if (alive) setState(result)
      } catch {
        if (alive) setState({ status: 'error' })
      }
    })()
    return () => {
      alive = false
    }
  }, [token, prRef, file, baseSha, headSha])

  return state
}
