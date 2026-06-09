import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './auth/AuthProvider'
import { supabaseConfigured } from './lib/supabase'
import { SetupNeeded } from './SetupNeeded'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigured
      ? <AuthProvider><App /></AuthProvider>
      : <SetupNeeded />}
  </StrictMode>
)
