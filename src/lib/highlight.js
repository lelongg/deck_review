// Syntax highlighting via arborium (tree-sitter in WASM).
//
// Grammars are fetched on demand from the jsDelivr CDN the first time a given
// language appears, then cached for the page session. We highlight each diff
// row independently (one line at a time) — accurate for the vast majority of
// code, if imperfect across multi-line constructs like block comments. The
// hand-written diff parser still owns layout; arborium only colors the text.

import { useEffect, useState } from 'react'
import { loadGrammar } from '@arborium/arborium'

// File extension -> arborium grammar id. Only the languages people actually
// review PRs in; anything unknown falls back to plain (uncolored) text.
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  py: 'python', pyi: 'python',
  rs: 'rust', go: 'go', rb: 'ruby',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'c_sharp', php: 'php', swift: 'swift',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', markdown: 'markdown',
  html: 'html', htm: 'html', xml: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'scss', sass: 'scss', less: 'css',
  sql: 'sql', lua: 'lua', nix: 'nix', dart: 'dart', ex: 'elixir', exs: 'elixir',
  hs: 'haskell', ml: 'ocaml', clj: 'clojure', r: 'r', jl: 'julia', zig: 'zig',
}

// Bare filenames that imply a language without an extension.
const NAME_LANG = {
  Dockerfile: 'dockerfile',
  Makefile: 'make',
  'CMakeLists.txt': 'cmake',
}

// Resolve the arborium grammar id for a file path, or null if unsupported.
export function languageForPath(filename) {
  const base = filename.slice(filename.lastIndexOf('/') + 1)
  if (NAME_LANG[base]) return NAME_LANG[base]
  const dot = base.lastIndexOf('.')
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
  return EXT_LANG[ext] || null
}

// lang -> Grammar | null (resolved) | Promise<Grammar|null> (in flight)
const cache = new Map()

function resolved(lang) {
  const c = cache.get(lang)
  return c && typeof c.highlight === 'function' ? c : null
}

// Load (once) the grammar for `language` and re-render when it's ready.
// Returns the Grammar object or null while loading / when unsupported.
export function useGrammar(language) {
  const [grammar, setGrammar] = useState(() => resolved(language))

  useEffect(() => {
    if (!language) {
      setGrammar(null)
      return
    }
    const ready = resolved(language)
    if (ready) {
      setGrammar(ready)
      return
    }
    let alive = true
    let pending = cache.get(language)
    if (!(pending instanceof Promise)) {
      pending = loadGrammar(language)
        .then((g) => {
          cache.set(language, g)
          return g
        })
        .catch(() => {
          cache.set(language, null)
          return null
        })
      cache.set(language, pending)
    }
    pending.then((g) => {
      if (alive && g) setGrammar(g)
    })
    return () => {
      alive = false
    }
  }, [language])

  return grammar
}

// Highlight every code row for a file once its grammar is ready, returning a
// Map<rowId, html>. `grammar.highlight()` is async (it lazy-loads the parser
// host from the CDN), so we await it; rows are highlighted in parallel and any
// per-row failure is skipped. Returns null until results are available, so the
// caller renders plain text in the meantime.
export function useHighlightedRows(grammar, rows) {
  const [map, setMap] = useState(null)

  useEffect(() => {
    if (!grammar) {
      setMap(null)
      return
    }
    let alive = true
    const codeRows = rows.filter(
      (r) =>
        (r.type === 'add' || r.type === 'del' || r.type === 'context') &&
        r.content,
    )
    Promise.all(
      codeRows.map(async (r) => {
        try {
          const html = await grammar.highlight(r.content)
          return [r.id, typeof html === 'string' ? html : null]
        } catch {
          return [r.id, null]
        }
      }),
    ).then((entries) => {
      if (!alive) return
      const result = new Map()
      for (const [id, html] of entries) if (html != null) result.set(id, html)
      setMap(result.size ? result : null)
    })
    return () => {
      alive = false
    }
  }, [grammar, rows])

  return map
}
