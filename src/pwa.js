import { registerSW } from 'virtual:pwa-register'

// Keep the installed app fresh. The service worker is built with
// registerType 'autoUpdate', so when a new build is found it activates and the
// page reloads on its own — but the browser only looks for a new worker on
// navigation. Here we also poll for updates on an interval and whenever the app
// regains focus, so an open tab / installed PWA picks up new deploys without a
// manual cache bust.
const CHECK_INTERVAL_MS = 60 * 1000

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const check = () => registration.update().catch(() => {})
    setInterval(check, CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})
