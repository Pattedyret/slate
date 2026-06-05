import { useState } from 'react'
import { useAuth } from './AuthProvider'

export function LoginScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await (mode === 'in' ? signIn(email, pw) : signUp(email, pw)) }
    catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="login">
      <h1>Slate</h1>
      <form onSubmit={submit}>
        <input type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="password" value={pw} onChange={e => setPw(e.target.value)} required minLength={6} />
        <button disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        {err && <p className="error">{err}</p>}
      </form>
      <button className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
      </button>
    </div>
  )
}
