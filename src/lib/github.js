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
    baseRef: pr.base?.ref,
    headRef: pr.head?.ref,
    author: pr.user?.login,
    htmlUrl: pr.html_url,
  }
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

// POST /repos/{owner}/{repo}/pulls/{n}/reviews — one call, all comments batched.
// `event` is APPROVE | REQUEST_CHANGES | COMMENT.
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

// Read each file's viewerViewedState (VIEWED | DISMISSED | UNVIEWED).
// Returns a map { filename: true } for files marked VIEWED on the server.
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
      if (node.viewerViewedState === 'VIEWED') viewed[node.path] = true
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
