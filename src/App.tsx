import { useAuth } from './auth/AuthProvider'
import { LoginScreen } from './auth/LoginScreen'
import { BoardView } from './board/BoardView'

export default function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="center">Loading…</div>
  return user ? <BoardView /> : <LoginScreen />
}
