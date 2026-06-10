import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthProvider'
import { supabaseConfigured } from './lib/supabase'
import { SetupNeeded } from './SetupNeeded'
import App from './App'
import './styles.css'

// PWA freshness: the SW (registerType 'autoUpdate') activates a new version immediately
// via skipWaiting + clientsClaim, but the already-loaded tab keeps serving the OLD cached
// bundle until it reloads — so a returning visitor stays on a stale version after a deploy
// until a manual hard-refresh. Reload once when an UPDATED worker takes control. Guards:
// `hadController` skips the first-ever install (no stale content to replace), and
// `reloading` prevents a reload loop.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigured
      ? <AuthProvider><App /></AuthProvider>
      : <SetupNeeded />}
  </StrictMode>
)
