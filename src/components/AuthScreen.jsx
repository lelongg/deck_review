import { useState } from 'react'
import { parsePrRef } from '../lib/prUrl.js'
import { setItem, removeItem, storageAvailable } from '../lib/storage.js'
import { TOKEN_KEY } from '../lib/constants.js'
import PrPicker from './PrPicker.jsx'

// Entry screen: paste a fine-grained PAT, then either browse repos/PRs or paste
// a PR URL. Optionally remember the token in localStorage (with a trust warning).
export default function AuthScreen({ onStart, savedToken, savedRef }) {
  const [token, setToken] = useState(savedToken || '')
  const [url, setUrl] = useState(
    savedRef
      ? `github.com/${savedRef.owner}/${savedRef.repo}/pull/${savedRef.number}`
      : '',
  )
  const [remember, setRemember] = useState(!!savedToken)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Validate + persist the token; returns it trimmed, or '' (and sets an error).
  function commitToken() {
    const trimmed = token.trim()
    if (!trimmed) {
      setError('A personal access token is required.')
      return ''
    }
    if (remember) setItem(TOKEN_KEY, trimmed)
    else removeItem(TOKEN_KEY)
    return trimmed
  }

  function submit(e) {
    e.preventDefault()
    setError('')

    const trimmed = commitToken()
    if (!trimmed) return

    const ref = parsePrRef(url)
    if (!ref) {
      setError('Could not read a PR from that URL. Try github.com/owner/repo/pull/123')
      return
    }
    onStart(trimmed, ref)
  }

  function openPicker() {
    setError('')
    const trimmed = commitToken()
    if (!trimmed) return
    setPickerOpen(true)
  }

  return (
    <div className="auth">
      <div className="auth__inner">
        <header className="auth__brand">
          <span className="brand__mark">▚</span>
          <h1 className="brand__name">deck</h1>
          <p className="brand__tag">swipe a pull request, one card at a time</p>
        </header>

        <form className="auth__form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">access token</span>
            <input
              className="field__input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <span className="field__hint">
              fine-grained PAT · scope <em>Pull requests: read &amp; write</em>
            </span>
          </label>

          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={openPicker}
          >
            browse repos &amp; PRs →
          </button>

          <div className="auth__or">
            <span>or paste a URL</span>
          </div>

          <label className="field">
            <span className="field__label">pull request url</span>
            <input
              className="field__input"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="github.com/owner/repo/pull/123"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              disabled={!storageAvailable}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              remember token on this device
              {remember && (
                <em className="check__warn">
                  {' '}— stored in plain localStorage; only on a device you trust
                </em>
              )}
            </span>
          </label>

          {error && <p className="auth__error">{error}</p>}

          <button className="btn" type="submit">
            open deck
          </button>
        </form>

        {pickerOpen && (
          <PrPicker
            token={token.trim()}
            onPick={(ref) => onStart(token.trim(), ref)}
            onClose={() => setPickerOpen(false)}
          />
        )}

        <footer className="auth__foot">
          <p>
            Runs entirely in your browser. Your token is sent only to
            api.github.com.
          </p>
          {!storageAvailable && (
            <p className="auth__foot-warn">
              storage is unavailable here — progress will not persist between
              reloads.
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
