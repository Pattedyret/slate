import type { Board } from '../lib/types'

interface Props {
  boards: Board[]; activeId: string | null; onSelect: (id: string) => void
  onAdd: () => void; onRename: (id: string, title: string) => void
  onDelete: (id: string) => void; onSignOut: () => void
}
export function TabBar({ boards, activeId, onSelect, onAdd, onRename, onDelete, onSignOut }: Props) {
  return (
    <div className="tabbar">
      {boards.map(b => (
        <div key={b.id} className={'tab' + (b.id === activeId ? ' active' : '')}
          onClick={() => onSelect(b.id)}
          onDoubleClick={() => { const t = prompt('Rename board', b.title); if (t) onRename(b.id, t) }}>
          {b.title}
          <span className="x" onClick={e => { e.stopPropagation(); if (confirm(`Delete "${b.title}"?`)) onDelete(b.id) }}>×</span>
        </div>
      ))}
      <button className="tab add" onClick={onAdd}>+</button>
      <button className="tab signout" onClick={onSignOut}>sign out</button>
    </div>
  )
}
