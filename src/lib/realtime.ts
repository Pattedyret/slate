import { supabase } from './supabase'
import type { BoardObject } from './types'

export interface BoardChannel {
  sendPoints: (id: string, type: BoardObject['type'], data: unknown) => void
  sendCommit: (object: BoardObject) => void
  sendDelete: (id: string) => void
  leave: () => void
}

export function joinBoard(
  boardId: string,
  handlers: {
    onLive: (msg: { id: string; type: BoardObject['type']; data: any }) => void
    onCommit: (o: BoardObject) => void
    onDelete: (id: string) => void
  },
): BoardChannel {
  const channel = supabase.channel(`board:${boardId}`, { config: { broadcast: { self: false } } })
  channel
    .on('broadcast', { event: 'live' },   ({ payload }) => handlers.onLive(payload))
    .on('broadcast', { event: 'commit' }, ({ payload }) => handlers.onCommit(payload))
    .on('broadcast', { event: 'delete' }, ({ payload }) => handlers.onDelete(payload.id))
    .subscribe()

  const send = (event: string, payload: unknown) => channel.send({ type: 'broadcast', event, payload })
  return {
    sendPoints: (id, type, data) => send('live', { id, type, data }),
    sendCommit: (object) => send('commit', object),
    sendDelete: (id) => send('delete', { id }),
    leave: () => { supabase.removeChannel(channel) },
  }
}
