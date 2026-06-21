// GitHub API layer. Pure client-side: the REST API sends CORS headers, so a
// browser app with a fine-grained PAT (Pull requests: read & write) needs no
// backend.

const API = 'https://api.github.com'
const GRAPHQL = 'https://api.github.com/graphql'

function restHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// Surface a useful message from a failed response. GitHub puts the human-
// readable reason in `message` (and sometimes `errors[].message`).
async function toError(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body.message || ''
    if (body.errors?.length) {
      const sub = body.errors
        .map((e) => e.message || `${e.field || ''} ${e.code || ''}`.trim())
        .filter(Boolean)
        .join('; ')
      if (sub) detail = detail ? `${detail} — ${sub}` : sub
    }
  } catch {
    detail = res.statusText
  }
  const err = new Error(detail || `Request failed (${res.status})`)
  err.status = res.status
  return err
}

// GET /repos/{owner}/{repo}/pulls/{n} — we need title + head.sha.
export async function fetchPullRequest(token, { owner, repo, number }) {
  const res = await fetch(`${API}/repos/${owner}/${repo}/pulls/${number}`, {
    headers: restHeaders(token),
  })
  if (!res.ok) throw await toError(res)
  const pr = await res.json()
  return {
    title: pr.title,
    number: pr.number,
    state: pr.state,
    draft: pr.draft,
    headSha: pr.head?.sha,
    baseSha: pr.base?.sha,
    baseRef: pr.base?.ref,
    headRef: pr.head?.ref,
    author: pr.user?.login,
    htmlUrl: pr.html_url,
  }
}

// GET /repos/{owner}/{repo}/pulls/{n} as a raw unified diff. The per-file
// `patch` from the files endpoint is omitted for large files / large PRs, so we
// use this fuller source to fill the gaps. Returns null when the diff is too
// large for the API (406) or otherwise unavailable — callers fall back to
// whatever per-file patches they have.
export async function fetchPullRequestDiff(token, { owner, repo, number }) {
  let res
  try {
    res = await fetch(`${API}/repos/${owner}/${repo}/pulls/${number}`, {
      headers: { ...restHeaders(token), Accept: 'application/vnd.github.diff' },
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  return res.text()
}

// GET /repos/{owner}/{repo}/pulls/{n}/files — paginate until a page is short.
export async function fetchPullRequestFiles(token, { owner, repo, number }) {
  const out = []
  for (let page = 1; ; page++) {
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      { headers: restHeaders(token) },
    )
    if (!res.ok) throw await toError(res)
    const batch = await res.json()
    for (const f of batch) {
      out.push({
        filename: f.filename,
        previousFilename: f.previous_filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch, // absent for binary / too-large files
        sha: f.sha,
      })
    }
    if (batch.length < 100) break
  }
  return out
}

// GET a file's raw text at a given ref. Returns null when the file doesn't
// exist there (404 — e.g. an added or deleted file) and throws on other errors.
export async function fetchFileText(token, { owner, repo }, path, ref) {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${encoded}?ref=${ref}`,
    { headers: { ...restHeaders(token), Accept: 'application/vnd.github.raw' } },
  )
  if (res.status === 404) return null
  if (!res.ok) throw await toError(res)
  return res.text()
}

// POST /repos/{owner}/{repo}/pulls/{n}/comments — post ONE inline review
// comment right away (a standalone comment, not part of a pending review).
// Returns the created comment (we keep its `id` so it can be deleted later).
export async function createReviewComment(
  token,
  { owner, repo, number },
  { commitId, path, line, side, startLine, startSide, body },
) {
  if (!commitId) throw new Error('PR head commit not loaded yet.')
  const payload = { body, commit_id: commitId, path, line, side }
  // Multi-line range: start_line is the first line, `line` the last.
  if (startLine != null && startLine !== line) {
    payload.start_line = startLine
    payload.start_side = startSide || side
  }
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/pulls/${number}/comments`,
    {
      method: 'POST',
      headers: { ...restHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!res.ok) throw await toError(res)
  return res.json()
}

// DELETE /repos/{owner}/{repo}/pulls/comments/{id} — remove a posted comment.
// A 404 means it's already gone, which we treat as success.
export async function deleteReviewComment(token, { owner, repo }, commentId) {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/pulls/comments/${commentId}`,
    { method: 'DELETE', headers: restHeaders(token) },
  )
  if (!res.ok && res.status !== 404) throw await toError(res)
}

// GET /repos/{owner}/{repo}/pulls/{n}/comments — every review comment on the
// PR (top-level + replies), paginated. Normalized to the fields we render.
export async function fetchPullRequestComments(token, { owner, repo, number }) {
  const out = []
  for (let page = 1; ; page++) {
    const res = await fetch(
      `${API}/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100&page=${page}`,
      { headers: restHeaders(token) },
    )
    if (!res.ok) throw await toError(res)
    const batch = await res.json()
    for (const c of batch) {
      out.push({
        id: c.id,
        inReplyToId: c.in_reply_to_id ?? null,
        path: c.path,
        side: c.side || 'RIGHT',
        // `line` is null for outdated comments; fall back to the original line.
        line: c.line ?? c.original_line ?? null,
        body: c.body,
        author: c.user?.login || '',
        createdAt: c.created_at,
        htmlUrl: c.html_url,
      })
    }
    if (batch.length < 100) break
  }
  return out
}

// POST /repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies — reply in a
// review-comment thread.
export async function createCommentReply(
  token,
  { owner, repo, number },
  commentId,
  body,
) {
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/pulls/${number}/comments/${commentId}/replies`,
    {
      method: 'POST',
      headers: { ...restHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  )
  if (!res.ok) throw await toError(res)
  return res.json()
}

// POST /repos/{owner}/{repo}/pulls/{n}/reviews — submit the overall verdict.
// `event` is APPROVE | REQUEST_CHANGES | COMMENT. Inline comments are posted
// live (see createReviewComment), so this carries only the summary + verdict.
export async function submitReview(
  token,
  { owner, repo, number },
  { commitId, event, body, comments },
) {
  const payload = { event }
  if (commitId) payload.commit_id = commitId
  if (body) payload.body = body
  if (comments?.length) {
    payload.comments = comments.map((c) => {
      const out = { path: c.path, line: c.line, side: c.side, body: c.body }
      // Multi-line comments: start_line is the first line of the range,
      // `line` the last. start_side defaults to side when omitted.
      if (c.startLine != null && c.startLine !== c.line) {
        out.start_line = c.startLine
        out.start_side = c.startSide || c.side
      }
      return out
    })
  }
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/pulls/${number}/reviews`,
    {
      method: 'POST',
      headers: { ...restHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!res.ok) throw await toError(res)
  return res.json()
}

// --- GraphQL viewed-state sync ----------------------------------------------
// Mirrors the same per-file "Viewed" checkboxes the GitHub web UI uses, so
// progress carries across devices. Best-effort: callers should tolerate
// failures (e.g. token without GraphQL access) and keep the local state.

async function graphql(token, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) throw await toError(res)
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '))
  }
  return json.data
}

// Read each file's viewerViewedState. Returns a map { filename: boolean } for
// ALL files in the PR (true only for VIEWED; UNVIEWED/DISMISSED → false), so
// callers can honor GitHub clearing the "viewed" flag when a file changes.
export async function fetchViewedState(token, { owner, repo, number }) {
  const query = `
    query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$number) {
          files(first:100, after:$cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { path viewerViewedState }
          }
        }
      }
    }`
  const viewed = {}
  let cursor = null
  for (;;) {
    const data = await graphql(token, query, { owner, repo, number, cursor })
    const conn = data?.repository?.pullRequest?.files
    if (!conn) break
    for (const node of conn.nodes) {
      viewed[node.path] = node.viewerViewedState === 'VIEWED'
    }
    if (!conn.pageInfo.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }
  return viewed
}

// We need the PR's GraphQL node id to drive the mutations.
export async function fetchPullRequestNodeId(token, { owner, repo, number }) {
  const query = `
    query($owner:String!, $repo:String!, $number:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$number) { id }
      }
    }`
  const data = await graphql(token, query, { owner, repo, number })
  return data?.repository?.pullRequest?.id ?? null
}

// Read the PR's review threads (inline comment conversations) over GraphQL —
// this is the only source that exposes each thread's resolved state and node
// id. Returns normalized threads with REST comment ids (databaseId) so replies
// and de-duping still work.
export async function fetchReviewThreads(token, { owner, repo, number }) {
  const query = `
    query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$number) {
          reviewThreads(first:50, after:$cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              comments(first:100) {
                nodes {
                  databaseId
                  body
                  createdAt
                  path
                  line
                  originalLine
                  diffSide
                  author { login }
                }
              }
            }
          }
        }
      }
    }`
  const out = []
  let cursor = null
  for (;;) {
    const data = await graphql(token, query, { owner, repo, number, cursor })
    const conn = data?.repository?.pullRequest?.reviewThreads
    if (!conn) break
    for (const node of conn.nodes) {
      out.push({
        threadId: node.id,
        isResolved: node.isResolved,
        comments: (node.comments?.nodes || []).map((c) => ({
          id: c.databaseId,
          path: c.path,
          side: c.diffSide || 'RIGHT',
          line: c.line ?? c.originalLine ?? null,
          body: c.body,
          author: c.author?.login || '',
          createdAt: c.createdAt,
        })),
      })
    }
    if (!conn.pageInfo.hasNextPage) break
    cursor = conn.pageInfo.endCursor
  }
  return out
}

// resolve / unresolve a review thread by its GraphQL node id.
export async function resolveReviewThread(token, threadId, resolved = true) {
  const mutation = resolved
    ? `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread { id } } }`
    : `mutation($id:ID!){ unresolveReviewThread(input:{threadId:$id}){ thread { id } } }`
  await graphql(token, mutation, { id: threadId })
}

// markFileAsViewed / unmarkFileAsViewed mutations take the PR node id + path.
export async function setFileViewedState(token, pullRequestId, path, viewed) {
  const mutation = viewed
    ? `mutation($id:ID!, $path:String!) {
         markFileAsViewed(input:{pullRequestId:$id, path:$path}) {
           clientMutationId
         }
       }`
    : `mutation($id:ID!, $path:String!) {
         unmarkFileAsViewed(input:{pullRequestId:$id, path:$path}) {
           clientMutationId
         }
       }`
  await graphql(token, mutation, { id: pullRequestId, path })
}
