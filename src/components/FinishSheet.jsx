import { useState } from 'react'
import { submitReview } from '../lib/github.js'

const EVENTS = [
  { id: 'COMMENT', label: 'comment', hint: 'leave notes, no verdict' },
  { id: 'APPROVE', label: 'approve', hint: 'looks good to merge' },
  {
    id: 'REQUEST_CHANGES',
    label: 'request changes',
    hint: 'blocks until addressed',
  },
]

// Finish sheet: submit the overall verdict + summary. Inline comments were
// already posted live as they were written, so this review carries no
// comments — just the Approve / Request changes / Comment verdict.
export default function FinishSheet({
  token,
  prRef,
  meta,
  isAuthor = false,
  comments,
  onClose,
  onExit,
}) {
  const [summary, setSummary] = useState('')
  const [event, setEvent] = useState('COMMENT')
  // GitHub rejects approve / request-changes on your own PR, so the author can
  // only leave a comment verdict.
  const blocked = (id) => isAuthor && id !== 'COMMENT'
  const [phase, setPhase] = useState('compose') // compose | sending | done | error
  const [error, setError] = useState('')

  async function submit() {
    setPhase('sending')
    setError('')
    try {
      await submitReview(token, prRef, {
        commitId: meta?.headSha,
        event,
        body: summary.trim(),
      })
      setPhase('done')
    } catch (err) {
      setError(err.message || 'Failed to submit review.')
      setPhase('error')
    }
  }

  // APPROVE / REQUEST_CHANGES with an empty summary is fine. A COMMENT verdict
  // carries no inline comments here, so it needs a summary or the API rejects.
  const canSubmit = !(event === 'COMMENT' && !summary.trim())

  return (
    <div className="sheet sheet--bottom" onClick={onClose}>
      <div className="finish" onClick={(e) => e.stopPropagation()}>
        {phase === 'done' ? (
          <div className="finish__done">
            <p className="finish__donemark">✓</p>
            <p className="finish__donetitle">review submitted</p>
            <p className="finish__donesub">
              {labelFor(event)} · {comments.length} note
              {comments.length === 1 ? '' : 's'} on {prRef.owner}/{prRef.repo} #
              {prRef.number}
            </p>
            <div className="finish__doneactions">
              <button className="btn" onClick={onExit}>
                another PR
              </button>
              <button className="btn btn--primary" onClick={onClose}>
                back to deck
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="finish__head">
              <span>finish review</span>
              <button className="iconbtn" onClick={onClose} aria-label="close">
                ×
              </button>
            </header>

            <p className="finish__count">
              {comments.length} comment{comments.length === 1 ? '' : 's'} posted
              this session
              <span className="finish__sub">
                {' '}
                · already on the PR — choose a verdict to finish
              </span>
            </p>

            <textarea
              className="finish__summary"
              rows={3}
              placeholder="overall summary (optional)…"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />

            <div className="finish__events">
              {EVENTS.map((ev) => (
                <button
                  key={ev.id}
                  className={`verdict ${
                    event === ev.id ? 'verdict--on' : ''
                  } verdict--${ev.id.toLowerCase()}`}
                  disabled={blocked(ev.id)}
                  title={
                    blocked(ev.id)
                      ? 'GitHub doesn’t allow this on your own PR'
                      : undefined
                  }
                  onClick={() => setEvent(ev.id)}
                >
                  <span className="verdict__label">{ev.label}</span>
                  <span className="verdict__hint">
                    {blocked(ev.id) ? 'unavailable on your own PR' : ev.hint}
                  </span>
                </button>
              ))}
            </div>

            {phase === 'error' && <p className="finish__error">{error}</p>}

            <button
              className="btn btn--primary btn--block"
              disabled={phase === 'sending' || !canSubmit}
              onClick={submit}
            >
              {phase === 'sending'
                ? 'submitting…'
                : `submit ${labelFor(event)}`}
            </button>
            {!canSubmit && (
              <p className="finish__guard">
                add a summary, or pick approve / request changes.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function labelFor(event) {
  return EVENTS.find((e) => e.id === event)?.label || event
}
