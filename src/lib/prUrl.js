// Parse a GitHub PR reference into { owner, repo, number }.
//
// Accepts the things a human actually pastes:
//   https://github.com/owner/repo/pull/123
//   github.com/owner/repo/pull/123
//   http://github.com/owner/repo/pull/123#discussion_r...
//   owner/repo/pull/123
//   owner/repo#123
//   owner/repo 123  (slug + number, loosely)
// Returns null when nothing usable is found.

export function parsePrRef(input) {
  if (!input) return null
  const text = String(input).trim()

  // Canonical .../pull/<n> form (with or without protocol/host).
  const pullMatch = text.match(
    /(?:github\.com\/)?([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i,
  )
  if (pullMatch) {
    return {
      owner: pullMatch[1],
      repo: pullMatch[2],
      number: Number(pullMatch[3]),
    }
  }

  // owner/repo#123 short form.
  const hashMatch = text.match(/^([^/\s]+)\/([^/\s#]+)#(\d+)$/)
  if (hashMatch) {
    return {
      owner: hashMatch[1],
      repo: hashMatch[2],
      number: Number(hashMatch[3]),
    }
  }

  return null
}

export function prSlug(ref) {
  return `${ref.owner}/${ref.repo}#${ref.number}`
}
