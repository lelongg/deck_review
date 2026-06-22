import { useEffect, useMemo, useState } from 'react'
import { fetchUserRepos, fetchOpenPulls } from '../lib/github.js'

// Browse the token's repos, then a repo's open PRs, and pick one — an
// alternative to pasting a PR URL on the entry screen.
export default function PrPicker({ token, onPick, onClose }) {
  const [repos, setRepos] = useState(null) // null = loading
  const [reposError, setReposError] = useState('')
  const [filter, setFilter] = useState('')
  const [repo, setRepo] = useState(null) // selected { owner, repo }

  useEffect(() => {
    let alive = true
    fetchUserRepos(token)
      .then((rs) => alive && setRepos(rs))
      .catch((err) => alive && setReposError(err.message || 'Failed to load repos.'))
    return () => {
      alive = false
    }
  }, [token])

  const shown = useMemo(() => {
    if (!repos) return []
    const q = filter.trim().toLowerCase()
    if (!q) return repos
    return repos.filter((r) => r.fullName.toLowerCase().includes(q))
  }, [repos, filter])

  return (
    <div className="sheet" onClick={onClose}>
      <aside className="picker" onClick={(e) => e.stopPropagation()}>
        <header className="picker__head">
          {repo ? (
            <button
              className="picker__back"
              onClick={() => setRepo(null)}
              aria-label="back to repositories"
            >
              ← repos
            </button>
          ) : (
            <span>pick a repository</span>
          )}
          <button className="iconbtn" onClick={onClose} aria-label="close">
            ×
          </button>
        </header>

        {repo ? (
          <PullList token={token} repo={repo} onPick={onPick} />
        ) : (
          <>
            <input
              className="picker__filter"
              type="text"
              placeholder="filter repositories…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="picker__items">
              {reposError && <p className="picker__error">{reposError}</p>}
              {!repos && !reposError && (
                <p className="picker__muted">loading repositories…</p>
              )}
              {repos && shown.length === 0 && !reposError && (
                <p className="picker__muted">no matching repositories</p>
              )}
              {shown.map((r) => (
                <button
                  key={r.fullName}
                  className="picker__item"
                  onClick={() => setRepo({ owner: r.owner, repo: r.repo })}
                >
                  <span className="picker__name">{r.fullName}</span>
                  {r.private && <span className="picker__tag">private</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function PullList({ token, repo, onPick }) {
  const [pulls, setPulls] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setPulls(null)
    setError('')
    fetchOpenPulls(token, repo)
      .then((ps) => alive && setPulls(ps))
      .catch((err) => alive && setError(err.message || 'Failed to load pull requests.'))
    return () => {
      alive = false
    }
  }, [token, repo])

  return (
    <div className="picker__items">
      <p className="picker__sub">
        {repo.owner}/{repo.repo} · open PRs
      </p>
      {error && <p className="picker__error">{error}</p>}
      {!pulls && !error && <p className="picker__muted">loading pull requests…</p>}
      {pulls && pulls.length === 0 && !error && (
        <p className="picker__muted">no open pull requests</p>
      )}
      {pulls?.map((p) => (
        <button
          key={p.number}
          className="picker__item picker__item--pr"
          onClick={() => onPick({ owner: repo.owner, repo: repo.repo, number: p.number })}
        >
          <span className="picker__prtitle">
            {p.draft && <span className="picker__tag">draft</span>}
            {p.title}
          </span>
          <span className="picker__prmeta">
            #{p.number} · {p.author}
          </span>
        </button>
      ))}
    </div>
  )
}
