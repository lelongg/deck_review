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

// Build a unified-diff patch (the @@-hunk body parsePatch expects) from the
// before/after text of a file.
function patchFromTexts(path, baseText, headText) {
  const sp = structuredPatch(
    path,
    path,
    baseText ?? '',
    headText ?? '',
    '',
    '',
    { context: 3 },
  )
  const lines = []
  for (const h of sp.hunks) {
    lines.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
    for (const l of h.lines) lines.push(l)
  }
  return lines.join('\n')
}

// Lazily reconstruct a file's diff from its blobs when GitHub didn't give us a
// patch (large file, or the whole-PR diff was too big). No-op when the file
// already has a patch. Returns { status, rows } — status is
// idle | loading | ready | binary | toolarge | error.
export function useFileDiff(token, prRef, file, baseSha, headSha) {
  const [state, setState] = useState({ status: 'idle' })

  useEffect(() => {
    if (file.patch || !headSha) {
      setState({ status: 'idle' })
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
        if (!alive) return
        if (isBinary(headText) || isBinary(baseText)) {
          setState({ status: 'binary' })
          return
        }
        if (
          (headText && headText.length > MAX_BYTES) ||
          (baseText && baseText.length > MAX_BYTES)
        ) {
          setState({ status: 'toolarge' })
          return
        }
        const patch = patchFromTexts(file.filename, baseText, headText)
        setState({ status: 'ready', rows: parsePatch(patch) })
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
