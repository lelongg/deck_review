import { useCallback, useState } from 'react'
import AuthScreen from './components/AuthScreen.jsx'
import ReviewDeck from './components/ReviewDeck.jsx'
import { getItem, getJSON, setJSON, removeItem } from './lib/storage.js'
import { TOKEN_KEY, SESSION_KEY } from './lib/constants.js'

// Top-level router. Two screens: auth, then the review deck. A `session` is
// { token, ref:{owner,repo,number} }. The PR ref is persisted so a reload can
// resume it; the token is only persisted when the user opted to remember it, so
// we can only auto-resume into the deck when both are available. Otherwise the
// auth screen pre-fills the saved PR URL.
export default function App() {
  const [session, setSession] = useState(() => {
    const token = getItem(TOKEN_KEY)
    const ref = getJSON(SESSION_KEY, null)
    if (token && ref && ref.owner && ref.repo && ref.number) {
      return { token, ref }
    }
    return null
  })

  const start = useCallback((token, ref) => {
    setJSON(SESSION_KEY, ref)
    setSession({ token, ref })
  }, [])

  const exit = useCallback(() => {
    removeItem(SESSION_KEY)
    setSession(null)
  }, [])

  if (!session) {
    return (
      <AuthScreen
        onStart={start}
        savedToken={getItem(TOKEN_KEY)}
        savedRef={getJSON(SESSION_KEY, null)}
      />
    )
  }

  return (
    <ReviewDeck
      token={session.token}
      prRef={session.ref}
      onExit={exit}
      // Re-key the whole deck per PR so all per-PR state resets cleanly.
      key={`${session.ref.owner}/${session.ref.repo}#${session.ref.number}`}
    />
  )
}
