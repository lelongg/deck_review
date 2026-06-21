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

// Highlight a single line to HTML. Returns null (caller renders plain text) on
// empty input, an async grammar, or any failure — highlighting must never
// break the diff.
export function highlightLine(grammar, text) {
  if (!grammar || !text) return null
  try {
    const html = grammar.highlight(text)
    return typeof html === 'string' ? html : null
  } catch {
    return null
  }
}
