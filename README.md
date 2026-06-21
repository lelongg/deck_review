# deck

**Mobile-first GitHub PR reviewer.** Reviewing a big diff on a phone is
miserable — every existing tool just shrinks a desktop diff viewer onto a small
screen. `deck` does the opposite: it turns a pull request into a sequence of
bounded review **cards** you swipe through. One file per card; triage 40 cards
instead of scrolling a 600-line page.

A real **Vite + React** app. Pure client-side — the GitHub REST API sends CORS
headers, so a browser app with a fine-grained token needs **no backend**.

## Design

- **Zero chrome.** The diff is the whole screen. Navigation is a swipe or a
  slide-over file list, never a permanent sidebar.
- **Reflow by default.** Long lines soft-wrap with `+`/`−` markers inline —
  toggle wrap off (top-bar button or `w`) to fall back to horizontal scroll.
  Tiny dense monospace by design.
- **Progress survives sessions.** Per-file viewed-state is persisted (keyed by
  PR) and best-effort synced to GitHub's own "Viewed" checkboxes via GraphQL.
- **Card stack** with subtle depth behind the active card and an amber progress
  gauge that fills as files are cleared. Honors `prefers-reduced-motion`.

Aesthetic: dark instrument/console feel — deep blue-slate ground, sodium-amber
accent (`#f2a900`), muted diff colors (`#7fd28c` / `#f08a8a`), mostly-monospace.

## Use

1. Create a **fine-grained PAT** with **Pull requests: read & write**.
2. `npm install && npm run dev` (add `-- --host` to reach it from your phone on
   the same LAN).
3. Paste the token + a PR URL (`github.com/owner/repo/pull/123`).
4. Swipe (or arrow-key) through the cards, tap a changed line to queue a note,
   "mark viewed" to clear a card, then **finish** → Approve / Request changes /
   Comment, which submits one batched review with all your notes.

The token is sent only to `api.github.com`. "Remember token" stores it in plain
`localStorage` — only enable it on a device you trust.

## How it works

- **Diff parsing** (`src/lib/parseDiff.js`): hand-written unified-diff parser,
  no dependency. Tracks old/new line numbers per row so comments anchor exactly:
  additions + context → `side: RIGHT` (new line), deletions → `side: LEFT`
  (old line).
- **API** (`src/lib/github.js`): paginates `pulls/{n}/files`, batches all
  comments into a single `POST .../reviews`, and syncs viewed-state over
  GraphQL (`markFileAsViewed` / `unmarkFileAsViewed`).
- **Storage** (`src/lib/storage.js`): every `localStorage` access is wrapped in
  try/catch with an in-memory fallback, so it never crashes in a sandboxed
  iframe or private mode.

## Build & host

```sh
npm run build      # static bundle in ./dist — host anywhere
npm run preview    # serve the built bundle locally
```

## NixOS

A dev shell with a pinned Node is provided:

```sh
nix develop        # drops you in with node 22 + npm
```

## Roadmap

- [x] Card-swipe deck, hand-written parser, viewed-tracking, batched review POST
- [x] GraphQL viewed-state sync (mirrors the web UI's checkboxes across devices)
- [x] PWA — installable + offline app shell via `vite-plugin-pwa` ("Add to Home
      Screen" launches standalone)
- [x] Line-range comments — drag the line-number gutter to select a span
- [ ] OAuth device flow instead of a pasted PAT
