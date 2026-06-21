import { useCallback, useState } from 'react'
import AuthScreen from './components/AuthScreen.jsx'
import ReviewDeck from './components/ReviewDeck.jsx'
import { getItem } from './lib/storage.js'
import { TOKEN_KEY } from './lib/constants.js'

// Top-level router. Two screens: auth, then the review deck. A `session` is
// { token, ref:{owner,repo,number} }; we keep it in component state and only
// persist the token if the user opted in.
export default function App() {
  const [session, setSession] = useState(null)

  const start = useCallback((token, ref) => {
    setSession({ token, ref })
  }, [])

  const exit = useCallback(() => {
    setSession(null)
  }, [])

  if (!session) {
    return <AuthScreen onStart={start} savedToken={getItem(TOKEN_KEY)} />
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
